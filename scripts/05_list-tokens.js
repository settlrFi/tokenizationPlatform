const hre = require("hardhat");
const { parseUnits, zeroPadValue } = require("ethers");
const { loadDeployments } = require("./lib/deployments");
const { getRuntime, requireSigner } = require("./lib/runtime");

async function main() {
  const { ethers, network } = hre;
  const dep = loadDeployments(network.name);

  if (!dep.market) throw new Error("Missing market. Run 03_deploy-market-proxy.js");
  if (!dep.oracle) throw new Error("Missing oracle. Run 02_deploy-oracle.js");
  if (!dep.fund) throw new Error("Missing fund. Run 04_create-token-proxies.js");
  if (!dep.equities) throw new Error("Missing equities map. Run 04_create-token-proxies.js");

  const runtime = await getRuntime(hre);
  const { admin, oracleUpdater } = runtime;
  const market = await ethers.getContractAt("Market", dep.market, admin);
  const updaterSigner = requireSigner(oracleUpdater, "Oracle updater");
  const oracle = await ethers.getContractAt("ReferenceOracle", dep.oracle, updaterSigner);

  const oracleDecimals = await oracle.decimals();
  const now = Math.floor(Date.now() / 1000);

  // ---------- Fund ----------
  const fundToken = await ethers.getContractAt("FundToken", dep.fund, admin);
  const fundDecimals = await fundToken.decimals();
  const fundId = zeroPadValue(dep.fund, 32);

  await (await market.listAsset(
    fundId,
    dep.fund,
    "FDLT",
    Number(fundDecimals),
    parseUnits("1", Number(fundDecimals))
  )).wait();

  await (await oracle.setPrice(
    fundId,
    parseUnits("101.23", Number(oracleDecimals)),
    now
  )).wait();

  console.log("Fund listed + NAV seeded:", { fund: dep.fund, id: fundId });

  // ---------- Equities (AAPL/MSFT/ISP.MI) ----------
  // Nota: symbolText è quello che vuoi vedere in UI, non l'id (l'id è fundId/eqId)
  const tokenDecimalsDefault = 6;

  for (const [symbolText, tokenAddr] of Object.entries(dep.equities)) {
    const eqToken = await ethers.getContractAt("EquityToken", tokenAddr, admin);
    const eqDecimals = await eqToken.decimals().catch(() => tokenDecimalsDefault);

    const eqId = zeroPadValue(tokenAddr, 32);

    await (await market.listAsset(
      eqId,
      tokenAddr,
      symbolText,
      Number(eqDecimals),
      parseUnits("0", Number(eqDecimals))
    )).wait();

    console.log("Equity listed:", { symbolText, token: tokenAddr, id: eqId });
  }

  // ---------- Stable peg (optional) ----------
  if (dep.stable) {
    const stId = zeroPadValue(dep.stable, 32);
    await (await oracle.setPrice(
      stId,
      parseUnits("1", Number(oracleDecimals)),
      now
    )).wait();
    console.log("Stable peg seeded:", { stable: dep.stable, id: stId });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
