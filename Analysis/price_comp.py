import pandas as pd

# === INPUT / OUTPUT ===
input_file = "swaps_last7d_raw.csv"
output_file = "swaps_last7d_with_price.csv"

# === Carica il CSV ===
df = pd.read_csv(input_file)

# === Controlla che le colonne necessarie esistano ===
required_cols = {"token_amount", "quote_amount"}
if not required_cols.issubset(df.columns):
    raise ValueError(f"Mancano colonne necessarie: {required_cols - set(df.columns)}")

# === Calcola il prezzo (quote per token) ===
df["price_quote_per_token"] = df["quote_amount"] / df["token_amount"]

# === Salva nuovo file ===
df.to_csv(output_file, index=False)

print(f"[✓] Nuovo file salvato: {output_file}")
print(df.head())
