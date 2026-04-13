const hre = require("hardhat");
const envAddress = require("./utils");
const { loadDeployments, saveDeployments } = require("./lib/deployments");

function farFutureSeconds(years = 10) {
  return Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * years;
}

function pickEvent(rc, iface, name) {
  for (const log of rc.logs) {
    try {
      const p = iface.parseLog(log);
      if (p && p.name === name) return p;
    } catch {}
  }
  return null;
}

async function createProxy(factory, typeId, initData) {
  const tx = await factory.create(typeId, initData);
  const rc = await tx.wait();
  const ev = pickEvent(rc, factory.interface, "TokenProxyCreated");
  if (!ev) throw new Error("TokenProxyCreated not found (check factory events)");
  return ev.args.proxy;
}

// Converte simboli tipo "ISP.MI" in "ISP_MI" per chiavi env
function envKeySymbol(sym) {
  return sym.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

async function grantCoreRoles(tokenName, tokenAddr, { admin, depositary, platform, complianceOfficer }) {
  const token = await hre.ethers.getContractAt(tokenName, tokenAddr, admin);

  const DEPOSITARY_ROLE = await token.DEPOSITARY_ROLE();
  const PLATFORM_ROLE   = await token.PLATFORM_ROLE();
  const PAUSER_ROLE     = await token.PAUSER_ROLE();
  const REGISTRY_ROLE   = await token.REGISTRY_ROLE();
  const COMPLIANCE_ROLE = await token.COMPLIANCE_ROLE();

  await (await token.grantRole(DEPOSITARY_ROLE, depositary.address)).wait();
  await (await token.grantRole(PLATFORM_ROLE, platform.address)).wait();
  await (await token.grantRole(PAUSER_ROLE, admin.address)).wait();
  await (await token.grantRole(REGISTRY_ROLE, admin.address)).wait();
  await (await token.grantRole(COMPLIANCE_ROLE, complianceOfficer.address)).wait();
}

/**
 * Fund-specific roles:
 * - NAV_UPDATER_ROLE on FundToken (so someone can call setNavAndRebase)
 * - UPDATER_ROLE on ReferenceOracle granted to FundToken proxy (so FundToken can call oracle.setReference)
 */
async function grantFundNavRoles(fundAddr, oracleAddr, { admin, navUpdaterAddress }) {
  // FundToken: grant NAV_UPDATER_ROLE to navUpdaterAddress
  const fund = await hre.ethers.getContractAt("FundToken", fundAddr, admin);
  const NAV_UPDATER_ROLE = await fund.NAV_UPDATER_ROLE();
  await (await fund.grantRole(NAV_UPDATER_ROLE, navUpdaterAddress)).wait();

  // Oracle: grant UPDATER_ROLE to the FundToken proxy (so FundToken can update its own NAV reference)
  const oracle = await hre.ethers.getContractAt("ReferenceOracle", oracleAddr, admin);
  const UPDATER_ROLE = await oracle.UPDATER_ROLE();
  await (await oracle.grantRole(UPDATER_ROLE, fundAddr)).wait();

  console.log("Fund NAV roles:");
  console.log(" - NAV_UPDATER_ROLE granted to:", navUpdaterAddress);
  console.log(" - Oracle UPDATER_ROLE granted to Fund proxy:", fundAddr);
}

async function main() {
  const { ethers, network } = hre;
  const dep = loadDeployments(network.name);

  if (!dep.factory) throw new Error("Missing factory. Run 00_deploy-implementations.js");
  if (!dep.complianceRegistry) throw new Error("Missing complianceRegistry. Run 01_deploy-compliance-proxy.js");
  if (!dep.oracle) throw new Error("Missing oracle. Run 02_deploy-oracle.js");

  // Nota: 02_deploy-oracle.js usa [admin, updater]. Qui i signers potrebbero essere diversi,
  // ma a noi basta avere l'admin per fare grantRole. L’address dell’updater lo prendiamo dai deployments.
  const [admin, complianceOfficer, depositary, platform, treasury, corpActionOperator] =
    await ethers.getSigners();

  const factory = await ethers.getContractAt("SecurityTokenBeaconFactory", dep.factory, admin);

  // ---------- Stable ----------
  const Stable = await ethers.getContractFactory("StableToken", admin);
  const stableInit = Stable.interface.encodeFunctionData("initializeStable", [
    "Stable DLT",
    "sDLT",
    admin.address,
    complianceOfficer.address,
    dep.complianceRegistry,
    dep.oracle,
    treasury.address,
    "Peg: 1.00 (reference oracle)",
  ]);

  const stableProxy = await createProxy(factory, await factory.TYPE_STABLE(), stableInit);

  // ---------- Fund ----------
  const Fund = await ethers.getContractFactory("FundToken", admin);
  const fundInit = Fund.interface.encodeFunctionData("initializeFund", [
    "DLT Fund",
    "fDLT",
    admin.address,
    complianceOfficer.address,
    dep.complianceRegistry,
    dep.oracle,
  ]);

  const fundProxy = await createProxy(factory, await factory.TYPE_FUND(), fundInit);

  // ---------- Equities  ----------
  const Equity = await ethers.getContractFactory("EquityToken", admin);

  const EQUITIES = [
    { symbolText: "AAPL",   name: "Apple Inc",       erc20Name: "Tokenized Apple Inc",       erc20Symbol: "tAAPL" },
    { symbolText: "MSFT",   name: "Microsoft",       erc20Name: "Tokenized Microsoft",       erc20Symbol: "tMSFT" },
    { symbolText: "ISP.MI", name: "Intesa Sanpaolo", erc20Name: "Tokenized Intesa Sanpaolo", erc20Symbol: "tISP_MI" },
  ];

  const equityProxies = {};

  for (const e of EQUITIES) {
    const meta = {
      issuerName: e.name,
      isin: "N/A",
      shareClass: "ORD",
      termsUri: "ipfs://demo-terms",
    };

    const equityInit = Equity.interface.encodeFunctionData("initializeEquity", [
      e.erc20Name,
      e.erc20Symbol,
      admin.address,
      complianceOfficer.address,
      dep.complianceRegistry,
      dep.oracle,
      corpActionOperator.address,
      meta,
    ]);

    const proxy = await createProxy(factory, await factory.TYPE_EQUITY(), equityInit);
    equityProxies[e.symbolText] = proxy;

    // env like old scripts: AAPL_ADDRESS=...
    envAddress(`${envKeySymbol(e.symbolText)}_ADDRESS`, proxy);
  }

  // ---------- Roles on all tokens ----------
  await grantCoreRoles("StableToken", stableProxy, { admin, depositary, platform, complianceOfficer });
  await grantCoreRoles("FundToken", fundProxy,   { admin, depositary, platform, complianceOfficer });

  for (const sym of Object.keys(equityProxies)) {
    await grantCoreRoles("EquityToken", equityProxies[sym], { admin, depositary, platform, complianceOfficer });
  }

  // ---------- Fund: NAV roles (NEW) ----------
  // Se 02_deploy-oracle.js ha salvato oracleUpdater lo usiamo, altrimenti fallback su platform.
  const navUpdaterAddress = dep.oracleUpdater || platform.address;
  await grantFundNavRoles(fundProxy, dep.oracle, { admin, navUpdaterAddress });

  // ---------- Compliance bootstrap ----------
  const registry = await ethers.getContractAt("ComplianceRegistry", dep.complianceRegistry, complianceOfficer);
  const expiry = farFutureSeconds(10);

  const actors = [
    admin.address,
    complianceOfficer.address,
    depositary.address,
    platform.address,
    treasury.address,
    corpActionOperator.address,
    dep.oracleUpdater || null, // opzionale: se vuoi whitelistare anche l'updater EOA
    stableProxy,
    fundProxy,
    ...Object.values(equityProxies),
  ].filter(Boolean);

  for (const a of actors) {
    await (await registry.setWhitelist(a, true)).wait();
    await (await registry.setKycExpiry(a, expiry)).wait();
  }

  // ---------- Persist deployments + env ----------
  const out = saveDeployments(network.name, {
    stable: stableProxy,
    fund: fundProxy,
    equities: equityProxies, // salva mappa
    depositary: depositary.address,
    platform: platform.address,
    treasury: treasury.address,
    corpActionOperator: corpActionOperator.address,
    fundNavUpdater: navUpdaterAddress,

  });

  envAddress("STABLE_ADDRESS", stableProxy);
  envAddress("FUND_ADDRESS", fundProxy);
  envAddress("EQUITY_AAPL_ADDRESS", equityProxies["AAPL"]);
  envAddress("EQUITY_MSFT_ADDRESS", equityProxies["MSFT"]);
  envAddress("EQUITY_ISP_MI_ADDRESS", equityProxies["ISP.MI"]);

  console.log("Created token proxies:");
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
