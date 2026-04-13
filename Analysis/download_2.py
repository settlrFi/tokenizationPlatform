# -*- coding: utf-8 -*-
# Estrae per ogni transazione che muove il token:
# - delta del token per il taker (compratore se focus_address è None)
# - corrispettivi netti in USDC/USDT/DAI/WETH (solo dai Transfer ERC-20)
# - prezzo eseguito in USDC (USDC + WETH * px; ETH non incluso con Infura)
#
# Requisiti: pip install web3 hexbytes

import os
import time
import csv
from collections import defaultdict
from datetime import datetime, timezone

from web3 import Web3
from hexbytes import HexBytes

# --------------------- CONFIG ---------------------
RPC = os.getenv("ETH_RPC", "https://mainnet.infura.io/v3/9d56d557b8ff4247a4928c5b368de038")
w3 = Web3(Web3.HTTPProvider(RPC))

# Token target (TSLAon)
TOKEN = Web3.to_checksum_address("0xf6b1117ec07684D3958cad8beb1b302bfd21103f")

# Quote tokens principali
USDC  = Web3.to_checksum_address("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
USDT  = Web3.to_checksum_address("0xdAC17F958D2ee523a2206206994597C13D831ec7")
DAI   = Web3.to_checksum_address("0x6B175474E89094C44Da98b954EedeAC495271d0F")
WETH  = Web3.to_checksum_address("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")

QUOTE_TOKENS = [USDC, USDT, DAI, WETH]

# Topic Transfer ERC-20
TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)").hex().lower()

# --------------------- ABI minimi ---------------------
ERC20_DECIMALS_ABI = [{
    "constant": True,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"type": "uint8"}],
    "stateMutability": "view",
    "type": "function",
}]

UNI_FACTORY = Web3.to_checksum_address("0x1F98431c8aD98523631AE4a59f267346ea31F984")
FACTORY_ABI = [{
    "inputs":[{"name":"tokenA","type":"address"},{"name":"tokenB","type":"address"},{"name":"fee","type":"uint24"}],
    "name":"getPool","outputs":[{"name":"pool","type":"address"}],"stateMutability":"view","type":"function"
}]
POOL_ABI = [{
    "inputs": [],
    "name": "slot0",
    "outputs": [
        {"name":"sqrtPriceX96","type":"uint160"},
        {"name":"tick","type":"int24"},
        {"name":"observationIndex","type":"uint16"},
        {"name":"observationCardinality","type":"uint16"},
        {"name":"observationCardinalityNext","type":"uint16"},
        {"name":"feeProtocol","type":"uint8"},
        {"name":"unlocked","type":"bool"},
    ],
    "stateMutability":"view",
    "type":"function",
}]

# --------------------- UTIL ---------------------
DECIMALS_CACHE = {}
def decimals(addr):
    """Legge decimals() con cache."""
    if addr not in DECIMALS_CACHE:
        DECIMALS_CACHE[addr] = w3.eth.contract(addr, abi=ERC20_DECIMALS_ABI).functions.decimals().call()
    return DECIMALS_CACHE[addr]

def to_checksum(topic_word):
    """Estrae indirizzo da topic[1/2] gestendo HexBytes o stringhe."""
    hx = topic_word.hex() if hasattr(topic_word, "hex") else str(topic_word)
    return Web3.to_checksum_address("0x" + hx[-40:])

def amount_from_data(data_hex):
    """Decodifica uint256 dal campo data dell'evento Transfer."""
    return int(HexBytes(data_hex).hex(), 16)

def safe_timestamp(block_num):
    ts = w3.eth.get_block(block_num)["timestamp"]
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

# --------------------- Uniswap v3 WETH/USDC midprice ---------------------
factory = w3.eth.contract(UNI_FACTORY, abi=FACTORY_ABI)

def get_pool(tokenA, tokenB, fee):
    return factory.functions.getPool(tokenA, tokenB, fee).call()

def first_pool(tokenA, tokenB):
    # prova le fee più comuni e anche 0.01% come fallback
    for fee in (500, 3000, 100):
        p = get_pool(tokenA, tokenB, fee)
        if int(p, 16) != 0:
            return Web3.to_checksum_address(p)
    return None

WETH_USDC_POOL = first_pool(WETH, USDC)
POOL_CONTRACT = w3.eth.contract(WETH_USDC_POOL, abi=POOL_ABI) if WETH_USDC_POOL else None

MIDPRICE_CACHE = {}
def midprice_weth_in_usdc_at_block(block_number):
    """Restituisce USDC per 1 WETH al blocco (Uniswap v3 slot0). Cache per blocco."""
    if not POOL_CONTRACT:
        return None
    if block_number in MIDPRICE_CACHE:
        return MIDPRICE_CACHE[block_number]
    # piccolo retry in caso di rate limit transiente
    for _ in range(3):
        try:
            s0 = POOL_CONTRACT.functions.slot0().call(block_identifier=block_number)
            sqrtP = s0[0]
            # token0 è l'indirizzo minore; calcoliamo price token1/token0
            token0 = min(WETH, USDC)
            token1 = max(WETH, USDC)
            dec0 = decimals(token0)
            dec1 = decimals(token1)
            price_t1_per_t0 = (sqrtP**2) / (2**192) * (10 ** (dec0 - dec1))
            # vogliamo USDC per 1 WETH
            if token0 == WETH and token1 == USDC:
                px = price_t1_per_t0
            else:
                px = 1 / price_t1_per_t0
            MIDPRICE_CACHE[block_number] = px
            return px
        except Exception:
            time.sleep(0.2)
    return None

# --------------------- CORE ---------------------
def extract_token_and_consideration(from_block, to_block, focus_address=None, outfile="transfers_with_consideration.csv"):
    """
    Estrae per ogni tx che muove TOKEN:
    - taker (focus_address oppure il compratore nella tx)
    - delta_token del taker
    - delta_usdc/usdt/dai/weth del taker
    - prezzo eseguito in USDC (USDC + WETH * px al blocco)
    """
    dec_token = decimals(TOKEN)
    dec_map = {addr: decimals(addr) for addr in QUOTE_TOKENS}

    rows = []
    step = 3500  # chunk dei getLogs
    seen_txs = set()

    print(f"[i] Scansione log Transfer TOKEN a chunk di {step} blocchi…")

    for start in range(from_block, to_block + 1, step):
        end = min(start + step - 1, to_block)
        # backoff leggero su get_logs
        for _ in range(5):
            try:
                logs = w3.eth.get_logs({
                    "fromBlock": start,
                    "toBlock": end,
                    "address": TOKEN,
                    "topics": [TRANSFER_TOPIC]
                })
                break
            except Exception:
                time.sleep(0.3)
        else:
            # se proprio fallisce, passa al prossimo chunk
            print(f"[!] get_logs fallito su chunk {start}-{end}, skip")
            continue

        # raggruppa per tx
        by_tx = defaultdict(list)
        for lg in logs:
            by_tx[lg["transactionHash"].hex()].append(lg)

        # elabora tx per tx
        for txh, _tlogs in by_tx.items():
            if txh in seen_txs:
                continue
            seen_txs.add(txh)

            # 1) una sola chiamata: receipt (contiene tutti i log già)
            receipt = None
            for _ in range(5):
                try:
                    receipt = w3.eth.get_transaction_receipt(txh)
                    break
                except Exception:
                    time.sleep(0.5)
            if receipt is None:
                continue

            block = receipt.blockNumber
            all_logs = receipt.logs

            # 2) delta TOKEN per ogni address (per dedurre il taker se non specificato)
            per_addr_token_delta = defaultdict(float)
            for lg in all_logs:
                if lg["address"].lower() != TOKEN.lower():
                    continue
                if len(lg["topics"]) >= 3 and lg["topics"][0].hex().lower() == TRANSFER_TOPIC:
                    frm = to_checksum(lg["topics"][1])
                    to_ = to_checksum(lg["topics"][2])
                    amt = amount_from_data(lg["data"]) / (10 ** dec_token)
                    per_addr_token_delta[frm] -= amt
                    per_addr_token_delta[to_]  += amt

            if not per_addr_token_delta:
                # nessun Transfer del token nella receipt (edge rarissimo)
                continue

            # 3) scegli il taker
            if focus_address:
                taker = Web3.to_checksum_address(focus_address)
            else:
                # address con delta_token massimo = compratore
                taker = max(per_addr_token_delta.items(), key=lambda kv: kv[1])[0]

            delta_token = per_addr_token_delta.get(taker, 0.0)

            # 4) delta dei quote tokens (USDC/USDT/DAI/WETH) per il taker analizzando i log della receipt
            quote_deltas = {str(a): 0.0 for a in QUOTE_TOKENS}
            for lg in all_logs:
                addr = lg["address"]
                if addr in QUOTE_TOKENS and len(lg["topics"]) >= 3 and lg["topics"][0].hex().lower() == TRANSFER_TOPIC:
                    frm = to_checksum(lg["topics"][1])
                    to_ = to_checksum(lg["topics"][2])
                    amt = amount_from_data(lg["data"]) / (10 ** dec_map[addr])
                    if to_.lower() == taker.lower():
                        quote_deltas[str(addr)] += amt
                    if frm.lower() == taker.lower():
                        quote_deltas[str(addr)] -= amt

            # 5) ETH nativo: con Infura non abbiamo trace -> None
            eth_delta = None

            # 6) Prezzo WETH/USDC al blocco (con cache + retry)
            price_weth_usdc = midprice_weth_in_usdc_at_block(block)

            # 7) Corrispettivo in USDC-equivalenti e prezzo eseguito
            usdc_equiv = quote_deltas[str(USDC)]
            if price_weth_usdc is not None:
                usdc_equiv += quote_deltas[str(WETH)] * price_weth_usdc
                # eth_delta escluso perché None con Infura

            price_usdc = (abs(usdc_equiv) / abs(delta_token)) if (usdc_equiv is not None and delta_token) else None

            rows.append({
                "tx_hash": txh,
                "block": block,
                "timestamp_utc": safe_timestamp(block),
                "taker": Web3.to_checksum_address(taker),
                "delta_token": delta_token,
                "delta_usdc": quote_deltas[str(USDC)],
                "delta_usdt": quote_deltas[str(USDT)],
                "delta_dai":  quote_deltas[str(DAI)],
                "delta_weth": quote_deltas[str(WETH)],
                "delta_eth":  eth_delta,                     # None con Infura
                "weth_usdc_mid_at_block": price_weth_usdc,
                "consideration_usdc_equiv": usdc_equiv,
                "exec_price_usdc": price_usdc
            })

        # piccolo respiro tra i chunk per non prendere 429
        time.sleep(0.15)

    # Salva CSV
    if rows:
        with open(outfile, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"[✓] Scritto: {outfile} ({len(rows)} righe)")
    else:
        print("[i] Nessuna tx che muove il token nel range scelto; nessun CSV scritto.")

# --------------------- MAIN ---------------------
if __name__ == "__main__":
    print("[i] Avvio estrazione…")
    latest = w3.eth.block_number
    from_blk = max(0, latest - 5000)   # modifica a piacere (es. ultimi ~5000 blocchi)
    to_blk   = latest
    print(f"[i] Finestra blocchi: {from_blk}..{to_blk}")

    extract_token_and_consideration(
        from_block=from_blk,
        to_block=to_blk,
        focus_address=None,  # oppure metti il TUO wallet se vuoi i delta per te
        outfile="tslaon_transfers_with_consideration.csv"
    )
