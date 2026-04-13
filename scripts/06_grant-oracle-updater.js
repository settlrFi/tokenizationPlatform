const hre = require("hardhat");
const { ethers } = hre;
const envAddress = require("./utils");
const { getRuntime } = require("./lib/runtime");

async function main() {
  const runtime = await getRuntime(hre);
  const { admin, oracleUpdater } = runtime;

  // prende gli address dal tuo env (stesso meccanismo degli altri script)
  const ORACLE = process.env.ORACLE_ADDRESS || envAddress("ORACLE_ADDRESS");
  const FUND   = process.env.FUND_ADDRESS   || envAddress("FUND_ADDRESS");

  if (!ORACLE || !FUND) {
    throw new Error("Missing ORACLE_ADDRESS or FUND_ADDRESS");
  }

  console.log("Oracle:", ORACLE);
  console.log("Fund proxy:", FUND);

  const oracle = await ethers.getContractAt("ReferenceOracle", ORACLE, admin);
  const role = await oracle.UPDATER_ROLE();

  const targetUpdater = oracleUpdater.address || FUND;
  const has = await oracle.hasRole(role, targetUpdater);

  if (has) {
    console.log("✔ Target already has UPDATER_ROLE");
    return;
  }

  console.log("Granting UPDATER_ROLE to:", targetUpdater);

  await (await oracle.grantRole(role, targetUpdater)).wait();

  const check = await oracle.hasRole(role, targetUpdater);

  console.log("Granted:", check);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
