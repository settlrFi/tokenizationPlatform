const hre = require("hardhat");
const envAddress = require("./utils");

const {STABLE_ADDRESS, ORACLE_ADDRESS} = process.env;

async function main() {

  const stable = STABLE_ADDRESS; // es. USDC testnet
  const oracle = ORACLE_ADDRESS;         // output da deploy-oracle
  const feeBps = 30;                        // 0.30%
  const maxStaleness = 120;                 // 120s

  const [admin] = await hre.ethers.getSigners();
  const Market = await hre.ethers.getContractFactory("Market");
  const market = await Market.connect(admin).deploy(stable, oracle, admin.address, feeBps, maxStaleness);

  const market_addr = await market.getAddress();
  envAddress("MARKET_ADDRESS", market_addr);
  
  console.log("Market:", market_addr);
}

main().catch((e) => { console.error(e); process.exit(1); });
