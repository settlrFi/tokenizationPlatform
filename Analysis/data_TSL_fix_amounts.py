#!/usr/bin/env python3
"""
calc_prices_from_transfers.py

Calcola prezzi impliciti (quote_amount / token_amount) usando transfer events
per un token e una lista di quote tokens (es. USDC, WETH, DAI) nell'ultima settimana.

Config ed esecuzione:
 - Imposta PROJECT_ID con il tuo project id GCP
 - Imposta GOOGLE_APPLICATION_CREDENTIALS nell'ambiente
 - pip install google-cloud-bigquery pandas
 - python3 calc_prices_from_transfers.py

Output:
 - per-tx CSV: prices_per_tx.csv
 - aggregate VWAP CSV: vwap_agg.csv
"""
import os
import math
from google.cloud import bigquery
import pandas as pd
from datetime import datetime, timezone

# --------------- CONFIG ----------------
PROJECT_ID = "centered-healer-475308-a3"   # sostituisci con il tuo project id
TOKEN_ADDR = "0xf6b1117ec07684d3958cad8beb1b302bfd21103f".lower()  # token target
# Quote tokens che vogliamo considerare per infer price (aggiungi/rimuovi se vuoi)
QUOTE_TOKENS = {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
    "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2".lower(): "WETH",
    "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
}
DAYS = 7   # finestra (ultimi N giorni)
OUT_TX_CSV = "prices_per_tx.csv"
OUT_VWAP_CSV = "vwap_agg.csv"
# ----------------------------------------

client = bigquery.Client(project=PROJECT_ID)

def query_decimals(addrs):
    """Ritorna dict address -> decimals (int). Fallback 18 se mancante."""
    addrs_l = ",".join(f"'{a.lower()}'" for a in addrs)
    q = f"""
    SELECT LOWER(address) as address, CAST(COALESCE(NULLIF(decimals,''),'18') AS INT64) AS decimals
    FROM `bigquery-public-data.crypto_ethereum.tokens`
    WHERE LOWER(address) IN ({addrs_l})
    """
    df = client.query(q).result().to_dataframe(create_bqstorage_client=False)
    out = {row['address']: int(row['decimals']) for _, row in df.iterrows()}
    for a in addrs:
        if a.lower() not in out:
            out[a.lower()] = 18
    return out

def fetch_transfers(addresses):
    """Scarica token_transfers per la lista di indirizzi nell'ultima finestra"""
    addrs_l = ",".join(f"'{a.lower()}'" for a in addresses)
    q = f"""
    SELECT
      LOWER(token_address) AS token_address,
      block_number,
      block_timestamp,
      transaction_hash,
      LOWER(from_address) AS from_address,
      LOWER(to_address) AS to_address,
      SAFE_CAST(value AS BIGNUMERIC) AS value_raw
    FROM `bigquery-public-data.crypto_ethereum.token_transfers`
    WHERE LOWER(token_address) IN ({addrs_l})
      AND block_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {DAYS} DAY)
    ORDER BY block_timestamp ASC
    """
    print("Eseguo query transfers (potrebbe impiegare qualche secondo)...")
    df = client.query(q).result().to_dataframe(create_bqstorage_client=False)
    return df

def fetch_swap_flags(tx_hashes):
    """Ritorna set di tx_hash dove nei logs appare un topic Swap (v2/v3) — euristica."""
    if not tx_hashes:
        return set()
    # limiti: fai in batch per non superare query troppo lunghe
    found = set()
    B = 800
    swap_topics = [
       "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",  # univ2 Swap
       "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",  # v3-ish
    ]
    for i in range(0, len(tx_hashes), B):
        batch = tx_hashes[i:i+B]
        v = ", ".join(f"'{h}'" for h in batch)
        topics_list = ", ".join(f"'{t}'" for t in swap_topics)
        q = f"""
        SELECT DISTINCT transaction_hash
        FROM `bigquery-public-data.crypto_ethereum.logs`
        WHERE transaction_hash IN ({v})
          AND topics[SAFE_OFFSET(0)] IN ({topics_list})
        """
        df = client.query(q).result().to_dataframe(create_bqstorage_client=False)
        for tx in df['transaction_hash'].tolist():
            found.add(tx)
    return found

def main():
    # addresses to query: main token + quotes
    addrs = [TOKEN_ADDR] + list(QUOTE_TOKENS.keys())
    decimals_map = query_decimals(addrs)
    print("Decimals map:", decimals_map)

    df = fetch_transfers(addrs)
    if df.empty:
        print("Nessun transfer trovato per la finestra richiesta. Esco.")
        return

    # scale amounts to human float using decimals_map
    df['decimals'] = df['token_address'].map(lambda a: decimals_map.get(a.lower(), 18))
    # value_raw is BIGNUMERIC (string-like); cast to float carefully
    def safe_float(x):
        try:
            return float(x)
        except:
            return float('nan')
    df['value_raw_f'] = df['value_raw'].apply(safe_float)
    df['amount_scaled'] = df.apply(lambda r: (r['value_raw_f'] / (10 ** int(r['decimals']))) if (not pd.isna(r['value_raw_f'])) else float('nan'), axis=1)

    # pivot per tx: somma assoluta per token (usiamo somma degli absolute amounts - heuristica)
    # prima manteniamo il token symbol mapping
    token_lookup = {TOKEN_ADDR: 'TARGET'}
    for k,v in QUOTE_TOKENS.items():
        token_lookup[k.lower()] = v
    df['token_symbol'] = df['token_address'].map(lambda a: token_lookup.get(a.lower(), a.lower()))

    # raggruppa per transaction_hash e token_address
    grouped = df.groupby(['transaction_hash', 'token_address'], as_index=False).agg({
        'block_timestamp': 'first',
        'amount_scaled': 'sum'
    }).rename(columns={'amount_scaled': 'sum_amount'})

    # pivot in wide: token_amount per tx for token and for each quote
    pivot = grouped.pivot_table(index=['transaction_hash','block_timestamp'], columns='token_address', values='sum_amount', fill_value=0).reset_index()
    # normalize column names
    pivot.columns = [c if isinstance(c, str) else (c[0] if c[1]=='' else c[1]) for c in pivot.columns.values]

    # ensure our token/quotes exist as columns
    for a in addrs:
        if a.lower() not in pivot.columns:
            pivot[a.lower()] = 0.0

    # compute per-tx price using the quote with max volume in that tx
    rows = []
    for _, r in pivot.iterrows():
        tx = r['transaction_hash']
        ts = pd.to_datetime(r['block_timestamp'])
        token_vol = r.get(TOKEN_ADDR, 0.0)
        # gather quote volumes
        best_quote = None
        best_quote_vol = 0.0
        for qaddr, qsym in QUOTE_TOKENS.items():
            vol = r.get(qaddr.lower(), 0.0)
            if vol > best_quote_vol:
                best_quote_vol = vol
                best_quote = (qaddr.lower(), qsym)
        price = None
        if token_vol > 0 and best_quote and best_quote_vol > 0:
            price = best_quote_vol / token_vol
        rows.append({
            'transaction_hash': tx,
            'block_timestamp': ts,
            'token_volume': token_vol,
            'quote_address': best_quote[0] if best_quote else None,
            'quote_symbol': best_quote[1] if best_quote else None,
            'quote_volume': best_quote_vol,
            'price_implied': price
        })
    df_prices = pd.DataFrame(rows)

    # mark tx that have swap logs (prefer these prices)
    tx_hashes = df_prices['transaction_hash'].dropna().tolist()
    swap_tx_set = fetch_swap_flags(tx_hashes)
    df_prices['has_swap_log'] = df_prices['transaction_hash'].apply(lambda x: x in swap_tx_set)

    # filter only rows where price_implied exists
    df_prices_valid = df_prices[df_prices['price_implied'].notna()].copy()

    # VWAP overall (weighted by token volume)
    if not df_prices_valid.empty:
        total_quote = df_prices_valid['quote_volume'].sum()
        total_token = df_prices_valid['token_volume'].sum()
        overall_vwap = (df_prices_valid['price_implied'] * df_prices_valid['token_volume']).sum() / df_prices_valid['token_volume'].sum()
    else:
        overall_vwap = None

    # daily VWAP
    if not df_prices_valid.empty:
        df_prices_valid['day'] = df_prices_valid['block_timestamp'].dt.date
        daily_vwap = df_prices_valid.groupby('day').apply(lambda g: pd.Series({
            'vwap': (g['price_implied'] * g['token_volume']).sum() / g['token_volume'].sum(),
            'token_volume': g['token_volume'].sum(),
            'quote_volume': g['quote_volume'].sum(),
            'n_trades': len(g)
        })).reset_index()
    else:
        daily_vwap = pd.DataFrame(columns=['day','vwap','token_volume','quote_volume','n_trades'])

    # salva CSV
    df_prices.to_csv(OUT_TX_CSV, index=False)
    daily_vwap.to_csv(OUT_VWAP_CSV, index=False)

    print("Risultati salvati:")
    print(" - per-transaction prices:", OUT_TX_CSV)
    print(" - daily VWAP:", OUT_VWAP_CSV)
    print("VWAP overall (weighted by token vol):", overall_vwap)
    print("Count per-tx price points:", len(df_prices_valid))
    # mostra prime righe
    if not df_prices_valid.empty:
        print(df_prices_valid.sort_values('block_timestamp').head(10).to_string(index=False))

if __name__ == "__main__":
    main()
