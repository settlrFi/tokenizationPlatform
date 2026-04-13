const hre = require("hardhat");
const envAddress = require("./utils");
const { saveDeployments } = require("./lib/deployments");
const { getRuntime } = require("./lib/runtime");

async function main() {
  const { ethers, network } = hre;
  const runtime = await getRuntime(hre);
  const { admin, oracleUpdater } = runtime;

  const Oracle = await ethers.getContractFactory("ReferenceOracle", admin);
  const oracle = await Oracle.deploy(8, admin.address); // decimals=8
  await oracle.waitForDeployment();

  const oracleAddr = await oracle.getAddress();
  const UPDATER_ROLE = await oracle.UPDATER_ROLE();

  await (await oracle.grantRole(UPDATER_ROLE, oracleUpdater.address)).wait();

  const out = saveDeployments(network.name, {
    oracle: oracleAddr,
    oracleAdmin: admin.address,
    oracleUpdater: oracleUpdater.address,
    oracleDecimals: 8,
  });

  envAddress("ORACLE_ADDRESS", oracleAddr);

  console.log("ReferenceOracle:", oracleAddr);
  console.log("UPDATER granted to:", oracleUpdater.address);
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
