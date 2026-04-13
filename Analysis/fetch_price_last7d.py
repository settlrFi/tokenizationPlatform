import os, time, math, sys, random
from datetime import datetime, timedelta, timezone
from web3 import Web3
import pandas as pd

# ---- RPC selection with fallback ----
RPC_CANDIDATES = [
    os.environ.get("ETH_RPC_URL"),
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
]

def connect_any(candidates):
    for url in [u for u in candidates if u]:
        try:
            w = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 45}))
            if w.is_connected():
                print(f"[i] Usando RPC: {url}")
                return w, url
        except Exception as e:
            pass
    raise SystemExit("Nessun RPC funzionante. Imposta ETH_RPC_URL o verifica la rete.")

w3, RPC_URL = connect_any(RPC_CANDIDATES)

# ---- Inputs ----
TOKEN = Web3.to_checksum_address("0xf6b1117ec07684d3958cad8beb1b302bfd21103f")  # token address

QUOTES = {
    "WETH": ("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
    "USDC": ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "USDT": ("0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    "DAI":  ("0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    "EUROC":("0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 6),
}

UNI_V2_FACTORY = Web3.to_checksum_address("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f")
UNI_V3_FACTORY = Web3.to_checksum_address("0x1F98431c8aD98523631AE4a59f267346ea31F984")
UNI_V3_FEES = [500, 3000, 10000]  # 0.05%, 0.3%, 1%

# ---- Minimal ABIs ----
ERC20_ABI = [
    {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
    {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"},
]
UNI_V2_FACTORY_ABI = [{
    "constant": True, "inputs":[{"name":"tokenA","type":"address"},{"name":"tokenB","type":"address"}],
    "name":"getPair","outputs":[{"name":"pair","type":"address"}],"stateMutability":"view","type":"function"
}]
UNI_V2_PAIR_ABI = [{
    "anonymous": False, "inputs": [
        {"indexed": True, "name": "sender", "type": "address"},
        {"indexed": False, "name": "amount0In", "type": "uint256"},
        {"indexed": False, "name": "amount1In", "type": "uint256"},
        {"indexed": False, "name": "amount0Out", "type": "uint256"},
        {"indexed": False, "name": "amount1Out", "type": "uint256"},
        {"indexed": True, "name": "to", "type": "address"}
    ], "name": "Swap", "type": "event"
}]
UNI_V3_FACTORY_ABI = [{
    "constant": True, "inputs":[{"name":"tokenA","type":"address"},{"name":"tokenB","type":"address"},{"name":"fee","type":"uint24"}],
    "name":"getPool","outputs":[{"name":"pool","type":"address"}],"stateMutability":"view","type":"function"
}]
UNI_V3_POOL_ABI = [{
    "anonymous": False, "inputs":[
        {"indexed": True,"name":"sender","type":"address"},
        {"indexed": True,"name":"recipient","type":"address"},
        {"indexed": False,"name":"amount0","type":"int256"},
        {"indexed": False,"name":"amount1","type":"int256"},
        {"indexed": False,"name":"sqrtPriceX96","type":"uint160"},
        {"indexed": False,"name":"liquidity","type":"uint128"},
        {"indexed": False,"name":"tick","type":"int24"}
    ], "name":"Swap","type":"event"
}]
PAIR_META_ABI = [
    {"constant":True,"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"constant":True,"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]

def erc20_meta(addr):
    c = w3.eth.contract(address=addr, abi=ERC20_ABI)
    try: sym = c.functions.symbol().call()
    except: sym = "TKN"
    try: dec = c.functions.decimals().call()
    except: dec = 18
    return sym, dec

TOKEN_SYM, TOKEN_DEC = erc20_meta(TOKEN)
print(f"[i] TOKEN {TOKEN_SYM} (decimals {TOKEN_DEC}) @ {TOKEN}")

# ---- Time window last 7 days ----
now = datetime.now(timezone.utc)
start = now - timedelta(days=7)

def get_block_by_timestamp(ts_utc: int, tolerance_seconds=60):
    latest = w3.eth.block_number
    low, high = 0, latest
    while low <= high:
        mid = (low + high)//2
        t = w3.eth.get_block(mid).timestamp
        if t < ts_utc - tolerance_seconds:
            low = mid + 1
        elif t > ts_utc + tolerance_seconds:
            high = mid - 1
        else:
            return mid
    return max(0, min(latest, low))

start_block = get_block_by_timestamp(int(start.timestamp()))
end_block   = w3.eth.block_number
print(f"[i] Intervallo: {start.isoformat()} .. {now.isoformat()}  | blocks {start_block}..{end_block}")

# ---- Discover pools ----
v2_factory = w3.eth.contract(address=UNI_V2_FACTORY, abi=UNI_V2_FACTORY_ABI)
v3_factory = w3.eth.contract(address=UNI_V3_FACTORY, abi=UNI_V3_FACTORY_ABI)

def checksum(a): return Web3.to_checksum_address(a)

pairs = []
for qsym, (qaddr, qdec) in QUOTES.items():
    q = checksum(qaddr)
    # v2
    try:
        pair_addr = v2_factory.functions.getPair(TOKEN, q).call()
        if int(pair_addr,16) != 0:
            pairs.append(("v2", checksum(pair_addr), qsym, qdec, None))
    except Exception: pass
    try:
        pair_addr = v2_factory.functions.getPair(q, TOKEN).call()
        if int(pair_addr,16) != 0:
            pairs.append(("v2", checksum(pair_addr), qsym, qdec, None))
    except Exception: pass
    # v3
    for fee in UNI_V3_FEES:
        try:
            pool_addr = v3_factory.functions.getPool(TOKEN, q, fee).call()
            if int(pool_addr,16) != 0:
                pairs.append(("v3", checksum(pool_addr), qsym, qdec, fee))
        except Exception: pass
        try:
            pool_addr = v3_factory.functions.getPool(q, TOKEN, fee).call()
            if int(pool_addr,16) != 0:
                pairs.append(("v3", checksum(pool_addr), qsym, qdec, fee))
        except Exception: pass

# Dedup by (dex, pool)
seen = set()
dedup = []
for (dex, pool, qsym, qdec, fee) in pairs:
    key = (dex, pool)
    if key not in seen:
        seen.add(key)
        dedup.append((dex, pool, qsym, qdec, fee))
pairs = dedup

if not pairs:
    KNOWN_POOL = "0x31227b50eCCDC9C589826AA2D9E7C5619B1895Da"
    pairs = [("v3", Web3.to_checksum_address(KNOWN_POOL), "USDC", 6, 10000)]
    print("[i] Uso KNOWN_POOL Uniswap v3 USDC 1%:", pairs[0])

print("[i] Pool trovati:")
for p in pairs:
    print("    ", p)

# ---- Backoff helpers ----
def with_backoff(fn, *args, **kwargs):
    delay = 1.0
    for attempt in range(8):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            if "429" in msg or "too many requests" in msg or "rate" in msg or "time" in msg:
                sleep_for = delay + random.uniform(0, 0.5)
                print(f"[warn] Rate limit/timeout, retry in {sleep_for:.1f}s (attempt {attempt+1})")
                time.sleep(sleep_for)
                delay = min(delay*2, 15.0)
                continue
            time.sleep(0.8)
    return fn(*args, **kwargs)

# ---- Logs fetch with smaller steps ----
def fetch_logs(address, abi, event_name, from_block, to_block):
    event = w3.eth.contract(address=address, abi=abi).events[event_name]()
    step = 900  # conservative for public RPC
    logs = []
    b = from_block
    while b <= to_block:
        chunk_to = min(to_block, b+step)
        try:
            evs = with_backoff(event.get_logs, fromBlock=b, toBlock=chunk_to)
            logs.extend(evs)
        except Exception as e:
            step = max(256, step // 2)
        b = chunk_to + 1
    return logs

# ---- Cached block timestamp ----
_block_ts_cache = {}
def get_block_ts(block_number=None, block_hash=None):
    if block_number is not None and block_number in _block_ts_cache:
        return _block_ts_cache[block_number]
    if block_hash is not None:
        blk = with_backoff(w3.eth.get_block, block_hash)
        ts = blk.timestamp
        if block_number is not None:
            _block_ts_cache[block_number] = ts
        return ts
    elif block_number is not None:
        blk = with_backoff(w3.eth.get_block, block_number)
        ts = blk.timestamp
        _block_ts_cache[block_number] = ts
        return ts
    else:
        raise ValueError("Provide block_number or block_hash")

rows = []

# ---- Process pools ----
for dex, pool, qsym, qdec, fee in pairs:
    if dex == "v2":
        evs = fetch_logs(pool, UNI_V2_PAIR_ABI, "Swap", start_block, end_block)
        pair_c = w3.eth.contract(address=pool, abi=PAIR_META_ABI)
        try:
            t0 = Web3.to_checksum_address(pair_c.functions.token0().call())
            t1 = Web3.to_checksum_address(pair_c.functions.token1().call())
        except Exception:
            continue
        if t0 == TOKEN:
            token_is0 = True
        elif t1 == TOKEN:
            token_is0 = False
        else:
            continue
        for ev in evs:
            args = ev["args"]
            amount0In  = int(args["amount0In"])
            amount1In  = int(args["amount1In"])
            amount0Out = int(args["amount0Out"])
            amount1Out = int(args["amount1Out"])
            net0 = amount0In - amount0Out
            net1 = amount1In - amount1Out
            if token_is0:
                token_amount_raw = abs(net0)
                quote_amount_raw = abs(net1)
            else:
                token_amount_raw = abs(net1)
                quote_amount_raw = abs(net0)
            if token_amount_raw == 0:
                continue
            token_amount = token_amount_raw / (10 ** TOKEN_DEC)
            quote_amount = quote_amount_raw / (10 ** qdec)
            price_q_per_token = quote_amount / token_amount
            ts = get_block_ts(block_number=ev["blockNumber"])
            rows.append({
                "dex":"univ2", "pool": pool, "fee": None, "quote": qsym,
                "block_number": ev["blockNumber"],
                "block_timestamp": datetime.fromtimestamp(ts, tz=timezone.utc),
                "tx_hash": ev["transactionHash"].hex(),
                "token_amount": token_amount,
                "quote_amount": quote_amount,
                "price_quote_per_token": price_q_per_token
            })

    if dex == "v3":
        evs = fetch_logs(pool, UNI_V3_POOL_ABI, "Swap", start_block, end_block)
        pool_c = w3.eth.contract(address=pool, abi=PAIR_META_ABI)
        try:
            t0 = Web3.to_checksum_address(pool_c.functions.token0().call())
            t1 = Web3.to_checksum_address(pool_c.functions.token1().call())
        except Exception:
            continue
        if t0 == TOKEN:
            token_is0 = True
        elif t1 == TOKEN:
            token_is0 = False
        else:
            continue
        for ev in evs:
            a0 = int(ev["args"]["amount0"])
            a1 = int(ev["args"]["amount1"])
            if token_is0:
                token_amount_raw = abs(a0)
                quote_amount_raw = abs(a1)
            else:
                token_amount_raw = abs(a1)
                quote_amount_raw = abs(a0)
            if token_amount_raw == 0:
                continue
            token_amount = token_amount_raw / (10 ** TOKEN_DEC)
            quote_amount = quote_amount_raw / (10 ** qdec)
            price_q_per_token = quote_amount / token_amount
            ts = get_block_ts(block_number=ev["blockNumber"])
            rows.append({
                "dex":"univ3", "pool": pool, "fee": fee, "quote": qsym,
                "block_number": ev["blockNumber"],
                "block_timestamp": datetime.fromtimestamp(ts, tz=timezone.utc),
                "tx_hash": ev["transactionHash"].hex(),
                "token_amount": token_amount,
                "quote_amount": quote_amount,
                "price_quote_per_token": price_q_per_token
            })

if not rows:
    print("[!] Nessuno swap trovato negli ultimi 7 giorni sui pool scoperti.")
    sys.exit(0)

df = pd.DataFrame(rows).sort_values(["block_timestamp","tx_hash"])
df.to_csv("swaps_last7d_raw.csv", index=False)
print("[i] Scritto swaps_last7d_raw.csv")

# ---- Price series: 5-min VWAP ----
df.set_index("block_timestamp", inplace=True)
out_list = []
for quote, g in df.groupby("quote"):
    r = g.resample("5T").agg({"quote_amount":"sum","token_amount":"sum"})
    r = r[(r["token_amount"]>0) & (r["quote_amount"]>0)]
    if not r.empty:
        r["VWAP"] = r["quote_amount"] / r["token_amount"]
        r["quote"] = quote
        out_list.append(r.reset_index())
if out_list:
    vwap = pd.concat(out_list, ignore_index=True)
    vwap.to_csv("price_last7d_vwap_5min.csv", index=False)
    print("[i] Scritto price_last7d_vwap_5min.csv")
else:
    print("[!] Nessun dato per VWAP 5-min.")

# ---- Daily VWAP ----
daily = df.groupby([pd.Grouper(freq="1D"), "quote"]).agg(
    notional_sum=("quote_amount","sum"),
    token_sum=("token_amount","sum"),
).reset_index()
daily["VWAP_daily"] = daily["notional_sum"] / daily["token_sum"]
daily.to_csv("price_last7d_vwap_daily.csv", index=False)
print("[i] Scritto price_last7d_vwap_daily.csv")

print("[✓] Fatto.")

