import React, { useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  Interface,
  Signature,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
} from "ethers";

import {
  FACTORY_ABI,
  PROXY_WALLET_READ_ABI,
  ERC20_PERMIT_READ_ABI,
  ERC20_IFACE_ABI,
  ERC20_READ_ABI,
} from "../abi";
import { PERMIT_TYPES, TYPES, permitDomain, walletDomain } from "../eip712";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL as string;

const FACTORY = getAddress(import.meta.env.VITE_FACTORY as string);
const BUNDLER = getAddress(import.meta.env.VITE_BUNDLER as string);
const MUSD = getAddress(import.meta.env.VITE_MUSD as string);
const RELAYER_ADDR = getAddress(import.meta.env.VITE_RELAYER_ADDR as string);
const FIXED_FEE_RAW = BigInt(import.meta.env.VITE_FIXED_FEE_RAW as string);

const WATCH_TOKENS_RAW = (import.meta.env.VITE_WATCH_TOKENS as string | undefined) ?? "";
const WATCH_TOKENS = Array.from(
  new Set(
    [MUSD, ...WATCH_TOKENS_RAW.split(",").map((s) => s.trim()).filter(Boolean)]
      .filter(isAddress)
      .map(getAddress)
  )
);

function short(a: string) {
  const x = getAddress(a);
  return `${x.slice(0, 6)}…${x.slice(-4)}`;
}

type TokenInfo = { address: string; symbol: string; decimals: number; balanceRaw: bigint };
type RelayerStatusPayload = {
  chainId?: string | number;
  config?: {
    factory?: string | null;
    bundler?: string | null;
    token?: string | null;
    relayer?: string | null;
    market?: string | null;
  };
};


async function waitForReceipt(
  provider: BrowserProvider,
  txHash: string,
  opts?: { pollMs?: number; timeoutMs?: number }
) {
  const pollMs = opts?.pollMs ?? 800;
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  const start = Date.now();
  while (true) {
    const r = await provider.getTransactionReceipt(txHash);
    if (r) return r;

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout waiting for receipt. txHash=${txHash}. ` +
          `Possibile mismatch RPC/chain tra dApp e relayer.`
      );
    }

    await new Promise((res) => setTimeout(res, pollMs));
  }
}

async function assertSameChain(provider: BrowserProvider, relayerUrl: string) {
  const [net, rel] = await Promise.all([
    provider.getNetwork(),
    fetch(`${relayerUrl}/relayerStatus`).then((r) => r.json()).catch(() => null),
  ]);

  // se l’endpoint non esiste o non torna JSON, non blocco: ma se torna, controllo
  if (rel?.chainId != null) {
    const clientChainId = Number(net.chainId);
    const relayerChainId = Number(rel.chainId);
    if (clientChainId !== relayerChainId) {
      throw new Error(
        `ChainId mismatch: dApp=${clientChainId}, relayer=${relayerChainId}. ` +
          `MetaMask sta puntando a una chain diversa dal relayer.`
      );
    }
  }
}


async function readToken(provider: BrowserProvider, tokenAddr: string, holder: string): Promise<TokenInfo> {
  const t = new Contract(tokenAddr, ERC20_READ_ABI, provider);
  const [sym, dec, bal] = await Promise.all([
    t.symbol().catch(() => short(tokenAddr)),
    t.decimals().catch(() => 18),
    t.balanceOf(holder),
  ]);
  return { address: tokenAddr, symbol: String(sym), decimals: Number(dec), balanceRaw: BigInt(bal) };
}

export default function ClientPage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState<string>("");

  // proxy wallet lifecycle (UI/cache)
  const [proxyWallet, setProxyWallet] = useState<string>("");
  const [walletDeployed, setWalletDeployed] = useState<boolean>(false);
  const [walletNonce, setWalletNonce] = useState<bigint>(0n);
  const [factoryWarning, setFactoryWarning] = useState<string>("");

  // portfolio
  const [ethBal, setEthBal] = useState<bigint>(0n);
  const [tokensEOA, setTokensEOA] = useState<TokenInfo[]>([]);
  const [tokensPW, setTokensPW] = useState<TokenInfo[]>([]);

  // deposit
  const [depositStr, setDepositStr] = useState<string>("10");

  // gasless send
  const [dest, setDest] = useState<string>("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const [amountStr, setAmountStr] = useState<string>("0.01");

  // ui
  const [status, setStatus] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [payloadPreview, setPayloadPreview] = useState<string>("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if ((window as any).ethereum) setProvider(new BrowserProvider((window as any).ethereum));
  }, []);

  async function connect() {
    if (!provider) throw new Error("No injected wallet found");
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    setAccount(getAddress(addr));
    setStatus("");
    setTxHash("");
  }

  async function getChainId(): Promise<number> {
    if (!provider) throw new Error("No provider");
    const net = await provider.getNetwork();
    return Number(net.chainId);
  }

  async function refreshWalletState(owner: string) {
    if (!provider || !owner) return;

    const factory = new Contract(FACTORY, FACTORY_ABI, provider);
    const predicted: string = await factory.predictWallet(owner);
    const pw = getAddress(predicted);
    setProxyWallet(pw);

    const code = await provider.getCode(pw);
    const deployed = !!code && code !== "0x";
    setWalletDeployed(deployed);

    if (deployed) {
      const w = new Contract(pw, PROXY_WALLET_READ_ABI, provider);
      const n: bigint = await w.nonce();
      setWalletNonce(BigInt(n));
    } else {
      setWalletNonce(0n);
    }
  }

  // IMPORTANT: for signing, resolve proxy+nonce fresh (avoid stale nonce)
  async function resolveProxyAndNonce(ownerAddr: string) {
    if (!provider) throw new Error("No provider");

    const factory = new Contract(FACTORY, FACTORY_ABI, provider);
    const predicted = getAddress(await factory.predictWallet(ownerAddr));

    const code = await provider.getCode(predicted);
    const deployed = !!code && code !== "0x";

    let nonce = 0n;
    if (deployed) {
      const w = new Contract(predicted, PROXY_WALLET_READ_ABI, provider);
      nonce = BigInt(await w.nonce());
    }
    return { proxyWallet: predicted, deployed, nonce };
  }

  useEffect(() => {
    refreshWalletState(account).catch((e) => setStatus(e?.message ?? String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, account]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const payload = (await fetch(`${RELAYER_URL}/relayerStatus`).then((r) => r.json())) as RelayerStatusPayload;
        const relayerFactory = payload?.config?.factory;
        if (!active) return;
        if (relayerFactory && getAddress(relayerFactory) !== FACTORY) {
          setFactoryWarning(
            `Factory mismatch: dApp=${FACTORY}, relayer=${getAddress(relayerFactory)}. Restart the proxy_wallet dApp after running deploy.`
          );
        } else {
          setFactoryWarning("");
        }
      } catch {
        if (active) setFactoryWarning("");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function refreshPortfolio() {
    if (!provider || !account) return;

    setEthBal(BigInt(await provider.getBalance(account)));

    const list = await Promise.all(WATCH_TOKENS.map((t) => readToken(provider, t, account)));
    setTokensEOA(list);

    if (proxyWallet) {
      const listPW = await Promise.all(WATCH_TOKENS.map((t) => readToken(provider, t, proxyWallet)));
      setTokensPW(listPW);
    } else {
      setTokensPW([]);
    }
  }

  useEffect(() => {
    refreshPortfolio().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, account, proxyWallet]);

  async function createWalletViaRelayer() {
    if (!account) {
      setStatus("Connect wallet first");
      return;
    }
    try {
      setBusy(true);
      setStatus("Requesting relayer to create ProxyWallet…");
      setTxHash("");

      const resp = await fetch(`${RELAYER_URL}/createWallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: account }),
      });

      const raw = await resp.text();
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      if (!resp.ok) throw new Error(parsed?.error ?? raw);

      if (parsed.txHash) {
        setTxHash(parsed.txHash);
        if (provider) await provider.waitForTransaction(parsed.txHash);
      }

      if (parsed.wallet && isAddress(parsed.wallet)) {
        const wallet = getAddress(parsed.wallet);
        setProxyWallet(wallet);
        const code = provider ? await provider.getCode(wallet) : "0x";
        const deployed = !!code && code !== "0x";
        setWalletDeployed(deployed);
        if (deployed && provider) {
          const w = new Contract(wallet, PROXY_WALLET_READ_ABI, provider);
          setWalletNonce(BigInt(await w.nonce()));
        }
      }

      setStatus(parsed.alreadyDeployed ? "Already deployed" : "Created");
      try {
        await refreshWalletState(account);
      } catch (refreshError: any) {
        const detail = refreshError?.message ?? String(refreshError);
        setStatus(
          `Created, but local factory config looks stale. ${detail}`
        );
      }
      await refreshPortfolio();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function depositToProxyWallet() {
    try {
      if (!provider) throw new Error("No provider");
      if (!account) throw new Error("Connect first");
      if (!proxyWallet) throw new Error("ProxyWallet not resolved");
      if (!depositStr || Number(depositStr) <= 0) throw new Error("Deposit amount must be > 0");

      setBusy(true);

      const signer = await provider.getSigner();

      // read decimals just-in-time
      const tokenRO = new Contract(MUSD, ERC20_PERMIT_READ_ABI, provider);
      const dec = Number(await tokenRO.decimals());
      const amount = parseUnits(depositStr, dec);

      const token = new Contract(MUSD, ["function transfer(address to, uint256 amount) returns (bool)"], signer);
      setStatus("Depositing mUSD to ProxyWallet (on-chain)…");
      setTxHash("");

      const tx = await token.transfer(proxyWallet, amount);
      setTxHash(tx.hash);
      await tx.wait();

      setStatus("Deposit completed");
      await refreshPortfolio();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // helper: get permit nonce from pending state (prevents “alternating” failures)
  async function getPermitNoncePending(token: Contract, owner: string): Promise<bigint> {
    try {
      return BigInt(await token.nonces(owner, { blockTag: "pending" }));
    } catch {
      return BigInt(await token.nonces(owner));
    }
  }

  // gasless deposit via bundleExecute (pull+fee, exec is no-op)  ==> questo TOCCA l'EOA (Permit)
  async function gaslessDeposit() {
    setStatus("");
    setTxHash("");
    setPayloadPreview("");

    try {
      if (!provider) throw new Error("No provider");
      if (!account) throw new Error("Connect first");
      if (!depositStr || Number(depositStr) <= 0) throw new Error("Deposit amount must be > 0");
      if (busy) throw new Error("Busy: wait for previous tx to complete");

      setBusy(true);

      const signer = await provider.getSigner();
      const ownerAddr = getAddress(await signer.getAddress());
      const chainId = await getChainId();

      const { proxyWallet: pw, nonce: nonceForDeposit } = await resolveProxyAndNonce(ownerAddr);

      // token just-in-time state
      const tokenRO = new Contract(MUSD, ERC20_PERMIT_READ_ABI, provider);
      const [tokenName, tokenDecimals] = await Promise.all([tokenRO.name(), tokenRO.decimals()]);
      const dec = Number(tokenDecimals);

      const permitNonce = await getPermitNoncePending(tokenRO, ownerAddr);

      const depositAmount = parseUnits(depositStr, dec);
      const feeAmount = FIXED_FEE_RAW;
      const pullAmount = depositAmount + feeAmount;

      const now = Math.floor(Date.now() / 1000);
      const permitDeadline = BigInt(now + 300);
      const execDeadline = BigInt(now + 300);

      // 1) Permit: owner(E0A) -> bundler allowance
      const pd = permitDomain(chainId, String(tokenName), MUSD);
      const permitMsg = {
        owner: ownerAddr,
        spender: BUNDLER,
        value: pullAmount,
        nonce: permitNonce,
        deadline: permitDeadline,
      };
      const permitSigRaw = await signer.signTypedData(pd as any, PERMIT_TYPES as any, permitMsg as any);
      const permitSig = Signature.from(permitSigRaw);

      // 2) Exec no-op (transfer(pw,0))
      const erc20Iface = new Interface(ERC20_IFACE_ABI as any);
      const noopData = erc20Iface.encodeFunctionData("transfer", [pw, 0n]);

      const execReq = {
        call: { to: MUSD, value: 0n, data: noopData, operation: 0 },
        nonce: nonceForDeposit,
        deadline: execDeadline,
        executor: BUNDLER,
        feeToken: MUSD,
        feeAmount: feeAmount,
        feeRecipient: RELAYER_ADDR,
      };

      const wd = walletDomain(chainId, pw);
      const execSig = await signer.signTypedData(
        wd as any,
        { Call: TYPES.Call, Execute: TYPES.Execute } as any,
        execReq as any
      );

      const payload = {
        token: MUSD,
        owner: ownerAddr,
        proxyWallet: pw,

        pullAmount: pullAmount.toString(),

        // for deterministic relayer checks
        permitNonce: permitNonce.toString(),
        permitDeadline: permitDeadline.toString(),

        permitSig: { v: permitSig.v, r: permitSig.r, s: permitSig.s },
        exec: {
          call: { to: execReq.call.to, value: "0", data: execReq.call.data, operation: 0 },
          nonce: execReq.nonce.toString(),
          deadline: execReq.deadline.toString(),
          executor: execReq.executor,
          feeToken: execReq.feeToken,
          feeAmount: execReq.feeAmount.toString(),
          feeRecipient: execReq.feeRecipient,
        },
        execSig,
        bundler: BUNDLER,
      };

      setPayloadPreview(JSON.stringify(payload, null, 2));

      setStatus("Sending gasless deposit packet to relayer…");
      const resp = await fetch(`${RELAYER_URL}/bundleExecute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      if (!resp.ok) throw new Error(typeof parsed === "string" ? parsed : parsed.error ?? JSON.stringify(parsed));

      const h = parsed.txHash ?? "";
      setTxHash(h);
      setStatus("Relayed. Waiting for confirmation…");

      await assertSameChain(provider, RELAYER_URL);

      const receipt = await waitForReceipt(provider, h, { pollMs: 700, timeoutMs: 45_000 });
      setStatus(`Confirmed in block ${receipt.blockNumber}`);

      //setStatus("Deposit completed (confirmed)");
      await refreshWalletState(account);
      await refreshPortfolio();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSendGasless = useMemo(() => {
    return !!provider && !!account && isAddress(dest) && Number(amountStr) > 0 && !busy;
  }, [provider, account, dest, amountStr, busy]);

  // ✅ GASLESS TRANSFER FROM PROXY WALLET:
  // - spends mUSD from ProxyWallet
  // - pays fee from ProxyWallet
  // - does NOT use Permit/EOA funds (EOA only signs the EIP712)
  // - send to relayer via POST /execute
  async function signAndSendGasless() {
    setStatus("");
    setTxHash("");
    setPayloadPreview("");

    try {
      if (!provider) throw new Error("No provider");
      if (!account) throw new Error("Connect first");
      if (!dest || !isAddress(dest)) throw new Error("Invalid destination");
      if (!amountStr || Number(amountStr) <= 0) throw new Error("Amount must be > 0");
      if (busy) throw new Error("Busy: wait for previous tx to complete");

      setBusy(true);

      const signer = await provider.getSigner();
      const ownerAddr = getAddress(await signer.getAddress());
      const destination = getAddress(dest);
      const chainId = await getChainId();

      // must be deployed (your /execute path reads w.nonce() and w.owner() on-chain)
      const { proxyWallet: pw, deployed } = await resolveProxyAndNonce(ownerAddr);
      if (!deployed) {
        throw new Error("ProxyWallet not deployed. Create it first (Create ProxyWallet via Relayer).");
      }

      // read proxy nonce fresh
      const pwRead = new Contract(pw, PROXY_WALLET_READ_ABI, provider);
      const nonceForExec = BigInt(await pwRead.nonce());

      // token decimals + balance check on proxy wallet (must cover amount + fee)
      const tokenRO = new Contract(MUSD, ERC20_PERMIT_READ_ABI, provider);
      const dec = Number(await tokenRO.decimals());

      const amount = parseUnits(amountStr, dec);
      const feeAmount = FIXED_FEE_RAW;
      const totalNeeded = amount + feeAmount;

      const proxyBal: bigint = BigInt(await tokenRO.balanceOf(pw));
      if (proxyBal < totalNeeded) {
        throw new Error(
          `Insufficient ProxyWallet mUSD balance. Needed=${formatUnits(totalNeeded, dec)} ` +
          `available=${formatUnits(proxyBal, dec)}`
        );
      }

      const now = Math.floor(Date.now() / 1000);
      const execDeadline = BigInt(now + 300);

      // call: mUSD.transfer(destination, amount)
      const erc20Iface = new Interface(ERC20_IFACE_ABI as any);
      const callData = erc20Iface.encodeFunctionData("transfer", [destination, amount]);

      // IMPORTANT: executor = RELAYER_ADDR (NOT bundler). Fee paid from proxy wallet.
      const execReq = {
        call: { to: MUSD, value: 0n, data: callData, operation: 0 },
        nonce: nonceForExec,
        deadline: execDeadline,
        executor: RELAYER_ADDR,
        feeToken: MUSD,
        feeAmount: feeAmount,
        feeRecipient: RELAYER_ADDR,
      };

      const wd = walletDomain(chainId, pw);
      const execSig = await signer.signTypedData(
        wd as any,
        { Call: TYPES.Call, Execute: TYPES.Execute } as any,
        execReq as any
      );

      const payload = {
        wallet: pw,
        request: {
          call: {
            to: execReq.call.to,
            value: "0",
            data: execReq.call.data,
            operation: 0,
          },
          nonce: execReq.nonce.toString(),
          deadline: execReq.deadline.toString(),
          executor: execReq.executor,
          feeToken: execReq.feeToken,
          feeAmount: execReq.feeAmount.toString(),
          feeRecipient: execReq.feeRecipient,
        },
        signature: execSig,
      };

      setPayloadPreview(JSON.stringify(payload, null, 2));

      setStatus("Sending ProxyWallet meta-tx to relayer (/execute)…");
      const resp = await fetch(`${RELAYER_URL}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await resp.text();
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      if (!resp.ok) throw new Error(typeof parsed === "string" ? parsed : parsed.error ?? JSON.stringify(parsed));

      const h = parsed.txHash ?? "";
      setTxHash(h);
      setStatus("Relayed. Waiting for confirmation…");

      await assertSameChain(provider, RELAYER_URL);

      const receipt = await waitForReceipt(provider, h, { pollMs: 700, timeoutMs: 45_000 });
      setStatus(`Confirmed in block ${receipt.blockNumber}`);

      //setStatus("Completed (confirmed)");
      await refreshWalletState(account);
      await refreshPortfolio();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="hero">
        <div className="brand">
          <div className="badge">
            <span className="dot" />
            <span className="label">ProxyWallet Gasless</span>
            <span className="pill">
              <span className="label">fee</span>&nbsp;<span className="value">{short(MUSD)} (mUSD)</span>
            </span>
          </div>
          <h1 className="h1">Client</h1>
          <p className="sub">
            Deposit on-chain + Gasless Deposit (EOA Permit) + Gasless Transfer (spend from ProxyWallet, fee from ProxyWallet, gas paid by relayer).
          </p>
        </div>

        <div className="row">
          {!account ? (
            <button className="btn btn-primary" onClick={() => connect().catch((e) => setStatus(e.message))}>
              Connect Wallet
            </button>
          ) : (
            <div className="pill">
              <span className="label">connected</span>
              <span className="mono">{short(account)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-inner">
            <div className="row">
              <div>
                <div className="label">ProxyWallet</div>
                <div className="small">Predicted via factory (client-side). Nonce resolved fresh on signing.</div>
              </div>
              <div className="pill">
                <span className={`label ${walletDeployed ? "good" : "warn"}`}>{walletDeployed ? "DEPLOYED" : "NOT DEPLOYED"}</span>
                <span className="mono">{proxyWallet ? short(proxyWallet) : "—"}</span>
              </div>
            </div>

            <div className="sep" />

            {factoryWarning ? (
              <>
                <div className="small" style={{ color: "#f59e0b", whiteSpace: "pre-wrap" }}>
                  {factoryWarning}
                </div>
                <div className="sep" />
              </>
            ) : null}

            <div className="kv">
              <div className="label">Factory</div>
              <div className="mono">{FACTORY}</div>

              <div className="label">Bundler</div>
              <div className="mono">{BUNDLER}</div>

              <div className="label">Relayer</div>
              <div className="mono">{RELAYER_ADDR}</div>

              <div className="label">Relayer API</div>
              <div className="mono">{RELAYER_URL}</div>

              <div className="label">Cached Wallet Nonce</div>
              <div className="mono">{walletNonce.toString()}</div>
            </div>

            <div style={{ height: 12 }} />
            <div className="row">
              <button className="btn btn-primary" disabled={!account || busy} onClick={() => createWalletViaRelayer()}>
                Create ProxyWallet via Relayer
              </button>
              <button className="btn" disabled={!account || busy} onClick={() => refreshWalletState(account).catch(() => {})}>
                Refresh Wallet State
              </button>
              <button className="btn" disabled={!account || busy} onClick={() => refreshPortfolio().catch(() => {})}>
                Refresh Balances
              </button>
            </div>

            <div className="sep" />

            <div className="label">Deposit mUSD → ProxyWallet (on-chain)</div>
            <div style={{ height: 10 }} />
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={depositStr} onChange={(e) => setDepositStr(e.target.value)} />
              <button className="btn btn-primary" disabled={!account || !proxyWallet || busy} onClick={() => depositToProxyWallet()}>
                Deposit
              </button>
            </div>

            <div className="sep" />

            <div className="label">Gasless Deposit mUSD → ProxyWallet (uses EOA Permit)</div>
            <div className="small" style={{ marginTop: 6 }}>
              This route uses Permit: it will touch EOA allowance/balance to pull funds into the ProxyWallet.
            </div>
            <div style={{ height: 10 }} />
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={depositStr} onChange={(e) => setDepositStr(e.target.value)} />
              <button className="btn btn-primary" disabled={!account || !provider || busy} onClick={() => gaslessDeposit()}>
                Gasless Deposit
              </button>
            </div>

            <div className="sep" />

            <div className="label">Gasless mUSD Transfer (FROM ProxyWallet, fee FROM ProxyWallet)</div>
            <div className="small" style={{ marginTop: 6 }}>
              Sends a meta-tx to <code>/execute</code>. ProxyWallet must already hold mUSD to cover amount + fee.
            </div>

            <div style={{ height: 10 }} />
            <div className="inputs">
              <div>
                <div className="label">Destination</div>
                <input className="input" value={dest} onChange={(e) => setDest(e.target.value)} />
              </div>
              <div>
                <div className="label">Amount (mUSD)</div>
                <input className="input" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
              </div>
            </div>

            <div style={{ height: 12 }} />
            <div className="row">
              <button className="btn btn-primary" disabled={!canSendGasless} onClick={() => signAndSendGasless()}>
                {busy ? "Processing…" : "Sign + Send Gasless"}
              </button>
            </div>

            <div style={{ height: 12 }} />

            {status && (
              <div className="toast">
                <div className="label">Status</div>
                <div className="value">{status}</div>
              </div>
            )}
            {txHash && (
              <div className="toast" style={{ marginTop: 10 }}>
                <div className="label">TxHash</div>
                <div className="mono">{txHash}</div>
              </div>
            )}

            <div className="sep" />

            <div className="label">Portfolio (EOA)</div>
            <div className="toast" style={{ marginTop: 8 }}>
              <div className="row">
                <div className="pill">
                  <span className="label">ETH</span>
                  <span className="value">{formatUnits(ethBal, 18)}</span>
                </div>
                <div className="small">Watchlist: {WATCH_TOKENS.map(short).join(", ")}</div>
              </div>
              <div style={{ height: 10 }} />
              {tokensEOA.map((t) => (
                <div className="row" key={`eoa-${t.address}`} style={{ padding: "6px 0" }}>
                  <div className="mono">{t.symbol}</div>
                  <div className="mono">{formatUnits(t.balanceRaw, t.decimals)}</div>
                  <div className="mono">{short(t.address)}</div>
                </div>
              ))}
            </div>

            <div className="label" style={{ marginTop: 12 }}>
              Portfolio (ProxyWallet)
            </div>
            <div className="toast" style={{ marginTop: 8 }}>
              {tokensPW.length === 0 ? (
                <div className="small">—</div>
              ) : (
                tokensPW.map((t) => (
                  <div className="row" key={`pw-${t.address}`} style={{ padding: "6px 0" }}>
                    <div className="mono">{t.symbol}</div>
                    <div className="mono">{formatUnits(t.balanceRaw, t.decimals)}</div>
                    <div className="mono">{short(t.address)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-inner">
            <div className="label">Packet Preview</div>
            <div className="small" style={{ marginTop: 6 }}>
              For gasless transfer-from-proxy this is the payload sent to <code>/execute</code>.
            </div>
            <div className="sep" />
            {payloadPreview ? (
              <pre>{payloadPreview}</pre>
            ) : (
              <div className="small">Generate a payload using Gasless Deposit or Gasless Transfer.</div>
            )}
          </div>
        </div>
      </div>

      <div className="footer">Client: deposit + gasless deposit (EOA permit) + gasless transfer (from proxy).</div>
    </div>
  );
}
