const hre = require("hardhat");
const { keccak256, toUtf8Bytes, parseUnits } = require("ethers");
const envAddress = require("./utils");

// Leggi gli indirizzi dall'env (.env o simile)
const { MARKET_ADDRESS, COMPLIANCE_REGISTRY, STABLE_ADDRESS } = process.env;

if (!MARKET_ADDRESS || !COMPLIANCE_REGISTRY || !STABLE_ADDRESS) {
  throw new Error("Missing MARKET_ADDRESS / COMPLIANCE_REGISTRY / STABLE_ADDRESS in env");
}

function idOf(sym) {
  return keccak256(toUtf8Bytes(sym.toUpperCase()));
}

async function deployAndListAsset({ symbol, name, tokenSymbol, tokenDecimals, minBuyAmount, admin, market }) {
  const registryAddress = COMPLIANCE_REGISTRY;
  const stableAddress = STABLE_ADDRESS;

  const id = idOf(symbol);
  const symbolText = symbol; // per chiarezza nella UI

  // 1) Deploy TokenizedAsset
  const TokenizedAsset = await hre.ethers.getContractFactory("TokenizedAsset", admin);
  const t = await TokenizedAsset.deploy(
    name,
    tokenSymbol,
    tokenDecimals,
    registryAddress,
    stableAddress
  );
  await t.waitForDeployment();

  const tokenAddr = await t.getAddress();

  // 2) Grant MINT_BURN_ROLE al Market
  const MINT_BURN_ROLE = await t.MINT_BURN_ROLE();
  const txRole = await t.grantRole(MINT_BURN_ROLE, MARKET_ADDRESS);
  await txRole.wait();

  // 3) Chiama listAsset sul Market
  const txList = await market
    .connect(admin)
    .listAsset(id, tokenAddr, symbolText, tokenDecimals, minBuyAmount);
  await txList.wait();

  // 4) Salva indirizzo token in env e logga
  envAddress(`${symbol}_ADDRESS`, tokenAddr);
  console.log(`${symbol} listed. Token: ${tokenAddr}`);
}

async function main() {
  const [admin] = await hre.ethers.getSigners();

  const Market = await hre.ethers.getContractFactory("Market", admin);
  const market = Market.attach(MARKET_ADDRESS);

  const tokenDecimals = 6;

  // AAPL
  await deployAndListAsset({
    symbol: "AAPL",
    name: "Tokenized Apple Inc",
    tokenSymbol: "tAAPL",
    tokenDecimals,
    minBuyAmount: parseUnits("0", tokenDecimals), // 0 = nessun minimo; cambia se vuoi
    admin,
    market,
  });

  // MSFT
  await deployAndListAsset({
    symbol: "MSFT",
    name: "Tokenized Microsoft",
    tokenSymbol: "tMSFT",
    tokenDecimals,
    minBuyAmount: parseUnits("0", tokenDecimals),
    admin,
    market,
  });

  // ISP.MI
  await deployAndListAsset({
    symbol: "ISP.MI",
    name: "Tokenized Intesa Sanpaolo",
    tokenSymbol: "tISP.MI",
    tokenDecimals,
    minBuyAmount: parseUnits("0", tokenDecimals),
    admin,
    market,
  });

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
