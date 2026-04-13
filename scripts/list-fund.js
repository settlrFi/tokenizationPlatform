// scripts/listFund.js
// Tokenization of a fund + NAV update on Oracle (all from JS variables).

const hre = require("hardhat");
const { keccak256, toUtf8Bytes, ZeroAddress, parseUnits } = require("ethers");
const envAddress = require("./utils"); // optional: used to persist addresses

/* ========= CONFIG ========= */
const { MARKET_ADDRESS, ORACLE_ADDRESS, COMPLIANCE_REGISTRY, STABLE_ADDRESS } = process.env;
const FALLBACK_ORACLE_DECIMALS = 8; // only for warning if on-chain read fails

// Fund data (used both for listing and for asset ID)
const FUND = {
  symbol:      "FDLT",            // logical ID (keccak256(symbol.toUpperCase()))
  name:        "DLT Growth Fund", // ERC20 readable name base
  shareClass:  "Class A",         // optional (UI)
  currency:    "USD",             // optional (UI)
  isin:        "LU1234567890",    // optional (UI)
  tokenSymbol: "tFDLT",           // ERC20 symbol
  decimals:    6,                 // ERC20 decimals for the fund token
};

// NAV to set on oracle (price per share)
const NAV = {
  price:        101.2345,         // NAV per share (decimal number)
  // unix timestamp in seconds. If null -> now()
  timestampSec: null,
};
/* ================================= */

function idOf(sym) {
  return keccak256(toUtf8Bytes(String(sym || "").toUpperCase()));
}

function buildUiSymbol(f) {
  // What the user sees as symbol in the UI
  return [f.symbol, f.shareClass, f.currency].filter(Boolean).join(" ").trim();
}

function buildErc20Name(f) {
  // ERC20 name: "Tokenized <name> - <class> (<ccy>)"
  return [
    "Tokenized",
    f.name,
    f.shareClass ? `- ${f.shareClass}` : "",
    f.currency ? `(${f.currency})` : "",
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const ORACLE_ABI = [
  "function setPrice(bytes32 id, uint256 price, uint64 timestamp) external",
  "function UPDATER_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "function decimals() view returns (uint8)",
];

async function ensureUpdaterRole(oracle, signer) {
  try {
    const role = await oracle.UPDATER_ROLE();
    const tx = await oracle.grantRole(role, await signer.getAddress());
    console.log("grantRole tx =", tx.hash);
    await tx.wait();
    console.log("UPDATER_ROLE granted (if signer is admin).");
  } catch (e) {
    // Not admin or already assigned: ok, just log
    console.log("UPDATER_ROLE: unable to grant or already granted (ignored).");
  }
}

async function setNavOnOracle({ oracle, symbol, navPrice, tsSec, decimals }) {
  const id = idOf(symbol);
  const scaled = parseUnits(navPrice.toString(), decimals); // BigInt
  const tx = await oracle.setPrice(id, scaled, tsSec);
  console.log(`[Oracle] ${symbol} NAV=${navPrice} (scaled=${scaled}) ts=${tsSec} tx=${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`[Oracle] mined: ${rcpt.hash}`);
}

async function main() {
  const { ethers } = hre;
  const [admin] = await ethers.getSigners();

  if (!MARKET_ADDRESS) throw new Error("Please set MARKET_ADDRESS in env.");
  if (!ORACLE_ADDRESS) throw new Error("Please set ORACLE_ADDRESS in env.");
  if (!COMPLIANCE_REGISTRY) throw new Error("Please set COMPLIANCE_REGISTRY in env.");
  if (!STABLE_ADDRESS) throw new Error("Please set STABLE_ADDRESS in env.");
  if (!FUND.symbol) throw new Error("FUND.symbol is missing");
  if (!FUND.name) throw new Error("FUND.name is missing");
  if (!FUND.tokenSymbol) throw new Error("FUND.tokenSymbol is missing");
  if (typeof NAV.price !== "number") throw new Error("NAV.price must be a number");

  const tokenDecimals = Number.isFinite(Number(FUND.decimals))
    ? Number(FUND.decimals)
    : 6;

  // ── Attach Market
  const Market = await ethers.getContractFactory("Market", admin);
  const market = Market.attach(MARKET_ADDRESS);

  const uiSymbol = buildUiSymbol(FUND);     // for UI
  const erc20Name = buildErc20Name(FUND);   // ERC20 name
  const id = idOf(FUND.symbol);

  // ── Check if already listed
  const existing = await market.tokenAddress(id);
  let tokenAddr;

  if (existing && existing !== ZeroAddress) {
    tokenAddr = existing;

    envAddress?.(`${FUND.symbol}_ADDRESS`, existing);
    envAddress?.(`${FUND.symbol}_ID`, id);
    if (FUND.isin)     envAddress?.(`${FUND.symbol}_ISIN`, FUND.isin);
    if (FUND.currency) envAddress?.(`${FUND.symbol}_CCY`, FUND.currency);

    console.log(`Already listed:
      - UI Symbol: ${uiSymbol}
      - Token: ${existing}
      - ID: ${id}`);
  } else {
    // ── Deploy TokenizedAsset for the fund
    const TokenizedAsset = await ethers.getContractFactory("TokenizedAsset", admin);
    const fundToken = await TokenizedAsset.deploy(
      erc20Name,
      FUND.tokenSymbol,
      tokenDecimals,
      COMPLIANCE_REGISTRY,
      STABLE_ADDRESS
    );
    await fundToken.waitForDeployment();
    tokenAddr = await fundToken.getAddress();

    // ── Grant MINT_BURN_ROLE to Market
    const MINT_BURN_ROLE = await fundToken.MINT_BURN_ROLE();
    const txRole = await fundToken.grantRole(MINT_BURN_ROLE, MARKET_ADDRESS);
    await txRole.wait();

    // ── List asset on Market (new signature):
    // listAsset(bytes32 id, address token, string symbolText, uint8 tokenDecimals, uint256 minBuyAmount)
    

    const minBuyAmount = parseUnits("1", tokenDecimals); // e.g. minimum 1 share

    const txList = await market.listAsset(
      id,
      tokenAddr,
      FUND.symbol,
      tokenDecimals,
      minBuyAmount
    );
    const rcpt = await txList.wait();

    envAddress?.(`${FUND.symbol}_ADDRESS`, tokenAddr);
    envAddress?.(`${FUND.symbol}_ID`, id);
    if (FUND.isin)     envAddress?.(`${FUND.symbol}_ISIN`, FUND.isin);
    if (FUND.currency) envAddress?.(`${FUND.symbol}_CCY`, FUND.currency);

    console.log(
      `Fund listed successfully:
      - UI Symbol: ${uiSymbol}
      - ERC20 Name: ${erc20Name}
      - ERC20 Symbol: ${FUND.tokenSymbol}
      - Decimals: ${tokenDecimals}
      - Token Address: ${tokenAddr}
      - Asset ID: ${id}
      - Tx Hash: ${rcpt?.hash}
      ${FUND.isin ? `- ISIN (UI): ${FUND.isin}` : ""}`
    );
  }

  // ── Attach Oracle
  const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, admin);

  // Read oracle decimals from chain
  let oracleDecimals = FALLBACK_ORACLE_DECIMALS;
  try {
    oracleDecimals = await oracle.decimals();
  } catch {
    console.warn(
      `Warning: cannot read decimals from oracle, using fallback=${FALLBACK_ORACLE_DECIMALS}`
    );
  }

  // Warning if fallback and on-chain differ (informational only)
  if (Number(oracleDecimals) !== Number(FALLBACK_ORACLE_DECIMALS)) {
    console.warn(
      `Warning: ORACLE_DECIMALS (fallback=${FALLBACK_ORACLE_DECIMALS}) differs from on-chain=${oracleDecimals}`
    );
  }

  // Try to grant UPDATER_ROLE to current signer (if it is admin)
  await ensureUpdaterRole(oracle, admin);

  // Set NAV for this fund on oracle
  const tsSec = Number.isFinite(Number(NAV.timestampSec))
    ? Number(NAV.timestampSec)
    : Math.floor(Date.now() / 1000); // now

  await setNavOnOracle({
    oracle,
    symbol: FUND.symbol,
    navPrice: Number(NAV.price),
    tsSec,
    decimals: Number(oracleDecimals),
  });

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
