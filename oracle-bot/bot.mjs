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
  ENFORCE_PRICE_AGE = 'false',
  PRICE_FETCH_TIMEOUT_MS = '8000',
  PRICE_FETCH_RETRIES = '2',
  EURUSD_FALLBACK = '',
  PRICE_FALLBACKS = '',
} = process.env;

if (!RPC_URL) throw new Error("Missing RPC_URL");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!ORACLE_ADDRESS) throw new Error("Missing ORACLE_ADDRESS");

const provider = new JsonRpcProvider(RPC_URL);
const baseWallet = new Wallet(PRIVATE_KEY, provider);
const wallet = new NonceManager(baseWallet);
const FETCH_TIMEOUT_MS = Number(PRICE_FETCH_TIMEOUT_MS);
const FETCH_RETRIES = Number(PRICE_FETCH_RETRIES);
const SHOULD_ENFORCE_PRICE_AGE = String(ENFORCE_PRICE_AGE).toLowerCase() === 'true';

const oracleAbi = [
  'function setPrice(bytes32 id, uint256 price, uint64 timestamp) external',
  'function UPDATER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function decimals() view returns (uint8)'
];
const oracle = new Contract(ORACLE_ADDRESS, oracleAbi, wallet);

function parseFallbacks(raw) {
  const map = new Map();
  for (const entry of String(raw || '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [key, value] = trimmed.split('=');
    const n = Number(value);
    if (!key || !Number.isFinite(n)) continue;
    map.set(key.trim().toUpperCase(), n);
  }
  return map;
}

const fallbackPrices = parseFallbacks(PRICE_FALLBACKS);

function getFallbackPrice(symbol) {
  const envKey = `${symbol.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PRICE`;
  const envValue = Number(process.env[envKey]);
  if (Number.isFinite(envValue)) return envValue;
  const listValue = fallbackPrices.get(symbol.toUpperCase());
  if (Number.isFinite(listValue)) return listValue;
  return null;
}

async function withRetry(label, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt > FETCH_RETRIES) break;
      const waitMs = attempt * 500;
      console.warn(`${label} failed (attempt ${attempt}/${FETCH_RETRIES + 1}), retrying in ${waitMs}ms:`, error?.message || error);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 tokenizationPlatform oracle-bot',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooChartQuote(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d&includePrePost=true`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  const error = data?.chart?.error;
  if (error) throw new Error(`Yahoo chart error for ${symbol}: ${error.description || error.code}`);
  const meta = result?.meta;
  const timestamps = result?.timestamp;
  const price = meta?.regularMarketPrice ?? meta?.previousClose;
  const ts = timestamps?.length ? Number(timestamps[timestamps.length - 1]) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(price) || !Number.isFinite(ts)) {
    throw new Error(`No price/time for ${symbol} from Yahoo chart endpoint`);
  }
  return { price, ts };
}

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

function fallbackQuote(symbol) {
  const price = getFallbackPrice(symbol);
  if (!Number.isFinite(price)) {
    throw new Error(`No fallback price configured for ${symbol}`);
  }
  return {
    price,
    ts: Math.floor(Date.now() / 1000),
    source: 'fallback-env',
  };
}

async function fetchEurUsd() {
  const directFallback = Number(EURUSD_FALLBACK);
  try {
    const q = await withRetry('EURUSD yahoo-finance2', () => yf.quote('EURUSD=X'));
    const fx = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
    if (!fx) throw new Error('No EURUSD price from Yahoo Finance');
    return { price: fx, source: 'yahoo-finance2' };
  } catch (primaryError) {
    try {
      const q = await withRetry('EURUSD yahoo-chart', () => fetchYahooChartQuote('EURUSD=X'));
      return { price: q.price, source: 'yahoo-chart' };
    } catch (chartError) {
      if (Number.isFinite(directFallback)) {
        return { price: directFallback, source: 'fallback-env' };
      }
      throw new Error(
        `EURUSD fetch failed. primary=${primaryError?.message || primaryError}; fallback=${chartError?.message || chartError}`
      );
    }
  }
}

async function fetchQuote(symbol) {
  try {
    const q = await withRetry(`${symbol} yahoo-finance2`, () => yf.quote(symbol));
    const price = q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice;
    const time = q.regularMarketTime ?? q.postMarketTime ?? q.preMarketTime;
    if (price == null || time == null) throw new Error(`No price/time for ${symbol}`);
    return { price, ts: Math.floor(Number(time) / 1000), source: 'yahoo-finance2' };
  } catch (primaryError) {
    try {
      const q = await withRetry(`${symbol} yahoo-chart`, () => fetchYahooChartQuote(symbol));
      return { price: q.price, ts: q.ts, source: 'yahoo-chart' };
    } catch (chartError) {
      const q = fallbackQuote(symbol);
      console.warn(
        `Using fallback price for ${symbol}. primary=${primaryError?.message || primaryError}; chart=${chartError?.message || chartError}`
      );
      return q;
    }
  }
}

async function pushPrice(symbol, oracleDecimals, eurUsdInfo) {
  const { price, ts, source } = await fetchQuote(symbol);
  const now = Math.floor(Date.now() / 1000);

  if (SHOULD_ENFORCE_PRICE_AGE && now - ts > Number(MAX_PRICE_AGE_S) && source !== 'fallback-env') {
    throw new Error(`Stale market price for ${symbol}: age=${now - ts}s`);
  }

  let effectivePrice = price;
  let sourceLabel = source;
  if (symbol.endsWith('.MI')) {
    if (!eurUsdInfo?.price) {
      throw new Error(`EURUSD rate missing while processing ${symbol}`);
    }
    effectivePrice = price * eurUsdInfo.price;
    sourceLabel += ` + EURUSD(${eurUsdInfo.source})`;
  }

  const assetId = toAssetId(symbol);
  const scaled = scalePrice(effectivePrice, Number(oracleDecimals));

  const tx = await oracle.setPrice(assetId, scaled, ts);
  console.log(`[${new Date().toISOString()}] ${symbol} -> ${effectivePrice} via ${sourceLabel} (id=${assetId}) tx=${tx.hash}`);
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

  let eurUsdInfo = null;
  try {
    eurUsdInfo = await fetchEurUsd();
    console.log(`Current EURUSD: ${eurUsdInfo.price} via ${eurUsdInfo.source}`);
  } catch (e) {
    console.warn('Unable to fetch EURUSD rate:', e.message || e);
  }

  for (const s of list) {
    try {
      tokenAddressForSymbol(s);
      await pushPrice(s, onchainDec, eurUsdInfo);
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
