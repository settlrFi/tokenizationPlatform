import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, NonceManager, zeroPadValue } from 'ethers';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance();
if (yf.suppressNotices) yf.suppressNotices(['yahooSurvey']);

const {
  RPC_URL,
  PRIVATE_KEY,
  ORACLE_ADDRESS,
  ORACLE_DECIMALS = '8',
  SYMBOLS = 'AAPL,MSFT,ISP.MI',
  UPDATE_INTERVAL_MS = '15000',
  MAX_PRICE_AGE_S = '120',
} = process.env;

if (!RPC_URL) throw new Error("Missing RPC_URL");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!ORACLE_ADDRESS) throw new Error("Missing ORACLE_ADDRESS");

const provider = new JsonRpcProvider(RPC_URL);
const baseWallet = new Wallet(PRIVATE_KEY, provider);
const wallet = new NonceManager(baseWallet);

const oracleAbi = [
  'function setPrice(bytes32 id, uint256 price, uint64 timestamp) external',
  'function UPDATER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function decimals() view returns (uint8)'
];
const oracle = new Contract(ORACLE_ADDRESS, oracleAbi, wallet);

// Converte "ISP.MI" -> "ISP_MI_ADDRESS"
const envKeyForSymbol = (sym) =>
  `${sym.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_ADDRESS`;

const tokenAddressForSymbol = (sym) => {
  const key = envKeyForSymbol(sym);
  const addr = process.env[key];
  if (!addr) {
    throw new Error(`Missing ${key} in env. Expected something like: ${key}=0x...`);
  }
  return addr;
};

// NEW: assetId = bytes32(address(tokenProxy))
const toAssetId = (sym) => {
  const tokenAddr = tokenAddressForSymbol(sym);
  return zeroPadValue(tokenAddr, 32);
};

// più robusto del float*10**decimals
const scalePrice = (p, decimals) => {
  const s = String(p);
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i + frac);
};

async function ensureRole() {
  try {
    const role = await oracle.UPDATER_ROLE();
    const tx = await oracle.grantRole(role, await wallet.getAddress());
    console.log('grantRole tx=', tx.hash);
    await tx.wait();
    console.log('UPDATER_ROLE granted to bot (if admin).');
  } catch {
    // non admin: ok
  }
}

async function fetchEurUsd() {
  const q = await yf.quote('EURUSD=X');
  const fx = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
  if (!fx) throw new Error('No EURUSD price from Yahoo Finance');
  return fx;
}

async function fetchQuote(symbol) {
  const q = await yf.quote(symbol);
  const price = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
  const time  = q.regularMarketTime ?? q.postMarketTime ?? q.preMarketTime; // ms
  if (price == null || time == null) throw new Error(`No price/time for ${symbol}`);
  return { price, ts: Math.floor(Number(time) / 1000) };
}

async function pushPrice(symbol, oracleDecimals, eurUsd) {
  const { price, ts } = await fetchQuote(symbol);
  const now = Math.floor(Date.now() / 1000);

  // opzionale: blocca prezzi troppo vecchi
  /*if (now - ts > Number(MAX_PRICE_AGE_S)) {
    throw new Error(`Stale Yahoo price for ${symbol}: age=${now - ts}s`);
  }*/

  let effectivePrice = price;
  if (symbol.endsWith('.MI')) {
    if (!eurUsd) {
      throw new Error(`EURUSD rate missing while processing ${symbol}`);
    }
    effectivePrice = price * eurUsd;
  }

  const assetId = toAssetId(symbol);
  const scaled = scalePrice(effectivePrice, Number(oracleDecimals));

  const tx = await oracle.setPrice(assetId, scaled, ts);
  console.log(`[${new Date().toISOString()}] ${symbol} -> ${effectivePrice} (id=${assetId}) tx=${tx.hash}`);
  const rec = await tx.wait();
  console.log(`   mined: ${rec.hash}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const onchainDec = await oracle.decimals();
  if (Number(ORACLE_DECIMALS) !== Number(onchainDec)) {
    console.warn(`Warning: ENV ORACLE_DECIMALS=${ORACLE_DECIMALS} differs from on-chain=${onchainDec}`);
  }

  await ensureRole();

  const list = SYMBOLS.split(',').map(s => s.trim()).filter(Boolean);

  let eurUsd = null;
  try {
    eurUsd = await fetchEurUsd();
    console.log(`Current EURUSD from Yahoo Finance: ${eurUsd}`);
  } catch (e) {
    console.warn('Unable to fetch EURUSD rate:', e.message || e);
  }

  for (const s of list) {
    try {
      // verifica che esista la mapping symbol -> address
      tokenAddressForSymbol(s);

      await pushPrice(s, onchainDec, eurUsd);
      await sleep(200);
    } catch (e) {
      console.error(`Update failed ${s}:`, e.shortMessage || e.message);
    }
  }
}

if (process.argv.includes('--once')) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  (async () => {
    await main();
    setInterval(main, Number(UPDATE_INTERVAL_MS));
  })().catch(e => { console.error(e); process.exit(1); });
}
