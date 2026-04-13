const hre = require("hardhat");
const envAddress = require("./utils");
const { saveDeployments } = require("./lib/deployments");
const { getRuntime } = require("./lib/runtime");

async function main() {
  const { ethers, upgrades, network } = hre;
  const runtime = await getRuntime(hre);
  const { admin, complianceOfficer } = runtime;

  const Reg = await ethers.getContractFactory("ComplianceRegistry", admin);

  // Questo è un proxy UUPS. Fa il dploy della implementation e del proxy insieme.
  const reg = await upgrades.deployProxy(
    Reg,
    [admin.address, complianceOfficer.address],
    { kind: "uups" }
  );
  await reg.waitForDeployment();

  const regAddr = await reg.getAddress();

  const out = saveDeployments(network.name, {
    complianceRegistry: regAddr,
    complianceAdmin: admin.address,
    complianceOfficer: complianceOfficer.address,
  });

  envAddress("COMPLIANCE_REGISTRY", regAddr);
  envAddress("CHAIN_ID", String(Number((await ethers.provider.getNetwork()).chainId)));

  console.log("ComplianceRegistry (proxy):", regAddr);
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
