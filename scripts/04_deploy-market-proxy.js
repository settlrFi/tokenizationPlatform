const hre = require("hardhat");
const envAddress = require("./utils");
const { loadDeployments, saveDeployments } = require("./lib/deployments");
const { getRuntime } = require("./lib/runtime");

async function main() {
  const { ethers, upgrades, network } = hre;
  const dep = loadDeployments(network.name);

  if (!dep.stable) throw new Error("Missing stable. Run 04_create-token-proxies.js first.");
  if (!dep.oracle) throw new Error("Missing oracle. Run 02_deploy-oracle.js first.");

  const runtime = await getRuntime(hre);
  const { admin, maker } = runtime;

  if (dep.market) {
    envAddress("MARKET_ADDRESS", dep.market);
    if (dep.marketDeployBlock) {
      envAddress("MARKET_DEPLOY_BLOCK", String(dep.marketDeployBlock));
    }
    console.log("Market (proxy) already deployed:", dep.market);
    console.log(dep);
    return;
  }

  const feeBps = 30;        // 0.30%
  const maxStaleness = 120; // seconds

  const Market = await ethers.getContractFactory("Market", admin);
  const market = await upgrades.deployProxy(
    Market,
    [dep.stable, dep.oracle, feeBps, maxStaleness, admin.address],
    { kind: "uups" }
  );
  await market.waitForDeployment();

  const marketAddr = await market.getAddress();
  const deploymentTx = market.deploymentTransaction();
  const marketDeployReceipt = deploymentTx ? await deploymentTx.wait() : null;
  const marketDeployBlock = marketDeployReceipt?.blockNumber || 0;
  await (await market.setMaker(maker.address)).wait();

  const out = saveDeployments(network.name, {
    market: marketAddr,
    marketDeployBlock,
    feeBps,
    maxStaleness,
    marketAdmin: admin.address,
    maker: maker.address,
  });

  envAddress("MARKET_ADDRESS", marketAddr);
  envAddress("MARKET_DEPLOY_BLOCK", String(marketDeployBlock));

  console.log("Market (proxy):", marketAddr);
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
