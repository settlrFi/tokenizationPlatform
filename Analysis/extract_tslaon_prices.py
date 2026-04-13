#!/usr/bin/env python3
import os, sys, time, random
from datetime import datetime, timedelta, timezone
from typing import Dict, List
import pandas as pd
from web3 import Web3

# === Config ===
TOKEN_ADDR = "0xf6b1117ec07684d3958cad8beb1b302bfd21103f"  # TSLAon
LOOKBACK_DAYS = 7

# RPC fallback (nessuna API key necessaria; usa ETH_RPC_URL se presente)
RPC_CANDIDATES = [
    os.environ.get("ETH_RPC_URL"),
    "https://rpc.ankr.com/eth",
    "https://eth.llamarpc.com",
    "https://cloudflare-eth.com",
]

TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)").hex()

def connect_any(cands: List[str]) -> Web3:
    for url in [u for u in cands if u]:
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 45}))
            if w3.is_connected():
                print(f"[i] RPC: {url}")
                return w3
        except Exception:
            pass
    raise SystemExit("Nessun RPC funzionante. Imposta ETH_RPC_URL o riprova.")

def backoff_call(fn, *args, retries=8, base=1.0, **kwargs):
    delay = base
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            msg = str(e).lower()
            transient = any(s in msg for s in ["429","too many","timeout","timed out","rate"])
            if transient:
                sleep_for = min(15.0, delay) + random.uniform(0, 0.4)
                print(f"[warn] Rate/timeout, retry in {sleep_for:.1f}s (attempt {i+1}/{retries})")
                time.sleep(sleep_for)
                delay *= 1.8
                continue
            time.sleep(0.6)
    return fn(*args, **kwargs)

def ts_to_block(w3: Web3, ts_utc: int, tol=60):
    latest = w3.eth.block_number
    lo, hi = 0, latest
    while lo <= hi:
        mid = (lo+hi)//2
        t = backoff_call(w3.eth.get_block, mid).timestamp
        if t < ts_utc - tol: lo = mid + 1
        elif t > ts_utc + tol: hi = mid - 1
        else: return mid
    return max(0, min(latest, lo))

def get_logs_for(w3: Web3, address: str, topic0: str, from_block: int, to_block: int):
    logs = []
    step = 900
    b = from_block
    while b <= to_block:
        e = min(to_block, b+step)
        try:
            chunk = backoff_call(
                w3.eth.get_logs,
                {"fromBlock": b, "toBlock": e, "address": address, "topics": [topic0]},
            )
            logs.extend(chunk)
        except Exception:
            step = max(256, step//2)
        b = e + 1
        time.sleep(0.05)  # gentile coi public RPC
    return logs

def topic_addr(topic_hex: str) -> str:
    return Web3.to_checksum_address("0x" + topic_hex[-40:])

def parse_transfer_log(log):
    from_addr = topic_addr(log["topics"][1].hex())
    to_addr   = topic_addr(log["topics"][2].hex())
    data_hex = log["data"].hex()
    if data_hex in ("0x", "0x0", ""):
        value_raw = 0
    else:
        value_raw = int(data_hex, 16)
    return {
        "block_number": log["blockNumber"],
        "block_hash": log["blockHash"].hex(),
        "tx_hash": log["transactionHash"].hex(),
        "log_index": log["logIndex"],
        "contract_address": Web3.to_checksum_address(log["address"]),
        "from_address": from_addr,
        "to_address": to_addr,
        "value_raw": value_raw,
    }


def erc20_meta(w3: Web3, addr: str):
    ERC20_ABI = [
        {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
        {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"},
    ]
    c = w3.eth.contract(address=addr, abi=ERC20_ABI)
    sym, dec = "TKN", 18
    try: sym = c.functions.symbol().call()
    except: pass
    try: dec = c.functions.decimals().call()
    except: pass
    return sym, int(dec)

def main():
    w3 = connect_any(RPC_CANDIDATES)
    TOKEN = Web3.to_checksum_address(TOKEN_ADDR)

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=LOOKBACK_DAYS)
    start_block = ts_to_block(w3, int(start.timestamp()))
    end_block   = w3.eth.block_number
    print(f"[i] Window: {start.isoformat()} .. {now.isoformat()} | blocks {start_block}..{end_block}")

    # 1) Transfer del token target
    token_logs = get_logs_for(w3, TOKEN, TRANSFER_TOPIC, start_block, end_block)
    print(f"[i] TSLAon Transfer logs: {len(token_logs)}")

    # parse grezzo
    token_rows = [parse_transfer_log(l) for l in token_logs]

    # 2) Tx uniche
    tx_hashes = sorted({r["tx_hash"] for r in token_rows})
    print(f"[i] Tx uniche con TSLAon: {len(tx_hashes)}")

    # 3) Per ogni tx: prendi TUTTI i log ERC-20 Transfer (qualsiasi token)
    all_rows = []
    _block_ts_cache = {}
    def block_ts(bn: int) -> int:
        if bn in _block_ts_cache: return _block_ts_cache[bn]
        ts = backoff_call(w3.eth.get_block, bn).timestamp
        _block_ts_cache[bn] = ts
        return ts

    for i, txh in enumerate(tx_hashes, 1):
        if i % 100 == 0:
            print(f"[i] Receipts {i}/{len(tx_hashes)}")
        rcpt = backoff_call(w3.eth.get_transaction_receipt, txh)
        bn = rcpt.blockNumber
        ts = block_ts(bn)
        # filtra solo log con topic0 = Transfer
        for log in rcpt["logs"]:
            if len(log["topics"]) >= 3 and log["topics"][0].hex().lower() == TRANSFER_TOPIC.lower():
                rec = parse_transfer_log(log)
                rec["block_timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                all_rows.append(rec)

    # 4) DataFrame + metadata decimals/symbol
    df_tok = pd.DataFrame(token_rows)
    if not df_tok.empty:
        df_tok["block_timestamp"] = df_tok["block_number"].map(
            lambda bn: datetime.fromtimestamp(_block_ts_cache.get(bn) or backoff_call(w3.eth.get_block, bn).timestamp, tz=timezone.utc).isoformat()
        )

    df_all = pd.DataFrame(all_rows)

    # Token metadata
    meta = {}
    for addr in sorted(set(df_all["contract_address"])) if not df_all.empty else []:
        sym, dec = erc20_meta(w3, addr)
        meta[addr] = {"token_address": addr, "symbol": sym, "decimals": dec}
    meta_df = pd.DataFrame(meta.values())

    # join decimals per value_decimal (facoltativo ma utile)
    if not df_all.empty and not meta_df.empty:
        dmap = meta_df.set_index("token_address")["decimals"].to_dict()
        df_all["decimals"] = df_all["contract_address"].map(dmap)
        df_all["value_decimal"] = df_all.apply(
            lambda r: (r["value_raw"] / (10 ** int(r["decimals"]))) if pd.notna(r.get("decimals")) else None,
            axis=1
        )
    if not df_tok.empty:
        # TSLAon ha 18 decimali, ma se vuoi, rileggi dal contratto:
        try:
            _, tok_dec = erc20_meta(w3, Web3.to_checksum_address(TOKEN_ADDR))
        except:
            tok_dec = 18
        df_tok["decimals"] = tok_dec
        df_tok["value_decimal"] = df_tok["value_raw"] / (10 ** int(tok_dec))

    # 5) Salva i tre file grezzi
    df_tok.to_csv("tslaon_transfers_last7d_raw.csv", index=False)
    df_all.to_csv("erc20_transfers_in_tslaon_txs_last7d_raw.csv", index=False)
    meta_df.to_csv("token_metadata.csv", index=False)

    print("[✓] Scritto:")
    print(" - tslaon_transfers_last7d_raw.csv")
    print(" - erc20_transfers_in_tslaon_txs_last7d_raw.csv")
    print(" - token_metadata.csv")

if __name__ == "__main__":
    main()
