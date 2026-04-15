const hre = require("hardhat");
const envAddress = require("./utils");
const { loadDeployments, saveDeployments } = require("./lib/deployments");
const { getRuntime } = require("./lib/runtime");

async function main() {
  const { ethers, network } = hre;
  const dep = loadDeployments(network.name);
  const runtime = await getRuntime(hre);
  const { admin, oracleUpdater } = runtime;

  let oracleAddr = dep.oracle;
  let oracle;

  if (oracleAddr) {
    oracle = await ethers.getContractAt("ReferenceOracle", oracleAddr, admin);
    console.log("ReferenceOracle already deployed:", oracleAddr);
  } else {
    const Oracle = await ethers.getContractFactory("ReferenceOracle", admin);
    oracle = await Oracle.deploy(8, admin.address); // decimals=8
    await oracle.waitForDeployment();
    oracleAddr = await oracle.getAddress();

    saveDeployments(network.name, {
      oracle: oracleAddr,
      oracleAdmin: admin.address,
      oracleUpdater: oracleUpdater.address,
      oracleDecimals: 8,
    });
  }

  const UPDATER_ROLE = await oracle.UPDATER_ROLE();
  const hasUpdaterRole = await oracle.hasRole(UPDATER_ROLE, oracleUpdater.address);

  if (!hasUpdaterRole) {
    await (await oracle.grantRole(UPDATER_ROLE, oracleUpdater.address)).wait();
  } else {
    console.log("UPDATER already granted to:", oracleUpdater.address);
  }

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
