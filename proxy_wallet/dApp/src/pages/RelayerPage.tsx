import React, { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress } from "ethers";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL as string;
const RELAYER_ADDR = getAddress(import.meta.env.VITE_RELAYER_ADDR as string);

function short(a: string) {
  const x = getAddress(a);
  return `${x.slice(0, 6)}…${x.slice(-4)}`;
}
function fmtTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString();
}

type RecentTx = {
  txHash: string;
  time?: number;
  route?: string;
  status?: "success" | "revert" | "pending" | string;

  owner?: string;
  proxyWallet?: string;
  to?: string;

  feeAmount?: string;
  blockNumber?: number;

  // opzionali: se il server li manda
  token?: string;
  feeToken?: string;
  feeRecipient?: string;
  value?: string;
  nonce?: string;
  deadline?: string;
};

export default function RelayerPage() {
  const [relayerStatus, setRelayerStatus] = useState<any>(null);
  const [err, setErr] = useState<string>("");

  // cache locale: “storico” accumulato dal polling di recentTxs
  const [history, setHistory] = useState<RecentTx[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [onlyFailed, setOnlyFailed] = useState<boolean>(false);

  useEffect(() => {
    let timer: any;

    async function poll() {
      try {
        setErr("");
        const r = await fetch(`${RELAYER_URL}/relayerStatus`);
        const raw = await r.text();
        const ct = r.headers.get("content-type") || "";

        if (!ct.includes("application/json")) {
        // tipicamente HTML 404/500 da Express
        throw new Error(
            `Expected JSON from /relayerStatus, got content-type="${ct}". ` +
            `First bytes: ${raw.slice(0, 120)}`
        );
        }

        const parsed = JSON.parse(raw);

        if (!r.ok) throw new Error(parsed?.error ?? raw);

        setRelayerStatus(parsed);

        const recent: RecentTx[] = Array.isArray(parsed.recentTxs) ? parsed.recentTxs : [];
        if (recent.length) {
          setHistory((prev) => {
            const byHash = new Map<string, RecentTx>();
            for (const p of prev) byHash.set(p.txHash, p);

            for (const t of recent) {
              // merge: se arriva una versione più completa, sovrascrivi campi
              const prevT = byHash.get(t.txHash);
              byHash.set(t.txHash, { ...(prevT ?? {}), ...t });
            }

            const arr = Array.from(byHash.values());
            // ordinamento: per time decrescente se presente, altrimenti keep stable
            arr.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
            return arr;
          });
        }
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    }

    poll();
    timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return history.filter((x) => {
      const st = (x.status ?? "").toLowerCase();
      if (onlyFailed && !(st.includes("revert") || st.includes("fail"))) return false;
      if (!f) return true;
      return JSON.stringify(x).toLowerCase().includes(f);
    });
  }, [history, filter, onlyFailed]);

  function exportJSON() {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relayer-local-history.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap">
      <div className="hero">
        <div className="brand">
          <div className="badge">
            <span className="dot" />
            <span className="label">ProxyWallet Gasless</span>
            <span className="pill">
              <span className="label">relayer</span>&nbsp;<span className="value">{short(RELAYER_ADDR)}</span>
            </span>
          </div>
          <h1 className="h1">Relayer</h1>
          <p className="sub">
            Senza modifiche a server.ts: la pagina mostra <code>/relayerStatus</code> e accumula localmente (nel browser) le <code>recentTxs</code>.
          </p>
        </div>

        <div className="row">
          <div className="pill">
            <span className="label">api</span>
            <span className="mono">{RELAYER_URL}</span>
          </div>
          <button className="btn" onClick={() => exportJSON()}>
            Export JSON (local)
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-inner">
            <div className="row">
              <div>
                <div className="label">Relayer status</div>
                <div className="small">Polling ogni 2s da <code>/relayerStatus</code>.</div>
              </div>
            </div>

            <div className="sep" />

            {err && (
              <div className="toast">
                <div className="label bad">Error</div>
                <div className="value">{err}</div>
              </div>
            )}

            {relayerStatus && (
              <>
                <div className="kv">
                  <div className="label">Relayer</div>
                  <div className="mono">{relayerStatus.relayer ?? RELAYER_ADDR}</div>

                  <div className="label">ChainId</div>
                  <div className="mono">{relayerStatus.chainId ?? "—"}</div>

                  <div className="label">ETH balance</div>
                  <div className="mono">{formatUnits(BigInt(relayerStatus.balances?.eth ?? "0"), 18)}</div>

                  <div className="label">mUSD balance</div>
                  <div className="mono">
                    {relayerStatus.balances?.musd
                      ? `${formatUnits(BigInt(relayerStatus.balances.musd.balance), relayerStatus.balances.musd.decimals)} ${relayerStatus.balances.musd.symbol}`
                      : "—"}
                  </div>

                  <div className="label">Local history size</div>
                  <div className="mono">{history.length}</div>
                </div>

                <div className="sep" />

                <div className="row">
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Filter (txHash, owner, proxyWallet, status...)"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <button className={`btn ${onlyFailed ? "btn-primary" : ""}`} onClick={() => setOnlyFailed((v) => !v)}>
                    Only failed
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-inner">
            <div className="row">
              <div>
                <div className="label">Tx feed</div>
                <div className="small">
                  Se <code>server.ts</code> espone solo poche <code>recentTxs</code>, qui vedrai solo quelle e il browser accumula “storico locale”.
                </div>
              </div>
              <div className="pill">
                <span className="label">shown</span>
                <span className="value">{filtered.length}</span>
              </div>
            </div>

            <div className="sep" />

            <div style={{ display: "grid", gap: 10 }}>
              {filtered.length === 0 && <div className="small">Nessuna tx visibile (serve che /relayerStatus includa recentTxs).</div>}

              {filtered.map((t) => (
                <details key={t.txHash} className="toast">
                  <summary style={{ cursor: "pointer", listStyle: "none" }}>
                    <div className="row">
                      <div className="pill">
                        <span
                          className={`label ${
                            (t.status ?? "").toLowerCase().includes("success")
                              ? "good"
                              : (t.status ?? "").toLowerCase().includes("revert")
                              ? "bad"
                              : "warn"
                          }`}
                        >
                          {t.status ?? "unknown"}
                        </span>
                        <span className="value">{t.route ?? "relayed"}</span>
                      </div>
                      <div className="small">{t.time ? fmtTime(t.time) : "—"}</div>
                    </div>

                    <div className="row" style={{ marginTop: 8 }}>
                      <div className="mono">tx: {t.txHash}</div>
                      {t.owner && <div className="mono">owner: {short(t.owner)}</div>}
                      {t.proxyWallet && <div className="mono">pw: {short(t.proxyWallet)}</div>}
                    </div>
                  </summary>

                  <div className="sep" />

                  <div className="kv">
                    <div className="label">TxHash</div>
                    <div className="mono">{t.txHash}</div>

                    <div className="label">Time</div>
                    <div className="mono">{t.time ? fmtTime(t.time) : "—"}</div>

                    <div className="label">Owner</div>
                    <div className="mono">{t.owner ?? "—"}</div>

                    <div className="label">ProxyWallet</div>
                    <div className="mono">{t.proxyWallet ?? "—"}</div>

                    <div className="label">To</div>
                    <div className="mono">{t.to ?? "—"}</div>

                    <div className="label">FeeAmount</div>
                    <div className="mono">{t.feeAmount ?? "—"}</div>

                    <div className="label">Block</div>
                    <div className="mono">{t.blockNumber ?? "—"}</div>

                    <div className="label">Token</div>
                    <div className="mono">{t.token ?? "—"}</div>

                    <div className="label">FeeToken</div>
                    <div className="mono">{t.feeToken ?? "—"}</div>

                    <div className="label">FeeRecipient</div>
                    <div className="mono">{t.feeRecipient ?? "—"}</div>

                    <div className="label">Value</div>
                    <div className="mono">{t.value ?? "—"}</div>

                    <div className="label">Nonce</div>
                    <div className="mono">{t.nonce ?? "—"}</div>

                    <div className="label">Deadline</div>
                    <div className="mono">{t.deadline ?? "—"}</div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="footer">Relayer: /relayerStatus + local cached feed.</div>
    </div>
  );
}
