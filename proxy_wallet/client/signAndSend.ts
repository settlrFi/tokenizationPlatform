import "dotenv/config";
import fetch from "node-fetch";
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  Interface,
  Signature,
  parseUnits,
  isAddress,
  getAddress,
} from "ethers";
import { domain, types } from "../src/eip712";

// -------- helpers
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
function mustAddress(name: string): string {
  const v = mustEnv(name);
  if (!isAddress(v)) throw new Error(`Invalid address for ${name}: ${v}`);
  return getAddress(v);
}

// -------- env
const RPC_URL = mustEnv("RPC_URL");
const RELAYER_URL = mustEnv("RELAYER_URL");

const USER_PK = mustEnv("USER_PRIVATE_KEY");
const RELAYER_ADDR = mustAddress("RELAYER_ADDR");

const WALLET_ADDRESS = mustAddress("PROXY_WALLET"); // ProxyWallet CLONE
const TOKEN = mustAddress("TOKEN");                 // MockERC20Permit (EIP-2612)
const BUNDLER = mustAddress("BUNDLER");             // RelayBundler

const DESTINATION = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const AMOUNT_TOKEN = "0.01";
const FEE_TOKEN = mustEnv("FEE_TOKEN");       // "0.001"

// -------- ABIs
const proxyWalletAbi = [
  "function nonce() view returns (uint256)",
] as const;

const erc20PermitReadAbi = [
  "function name() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

// EIP-2612 Permit types
const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const user = new Wallet(USER_PK, provider);
  const ownerAddr = await user.getAddress();
  const { chainId } = await provider.getNetwork();

  // --- read wallet nonce (meta-tx nonce)
  const w = new Contract(WALLET_ADDRESS, proxyWalletAbi, provider);
  const walletNonce: bigint = await w.nonce();

  // --- read token params for permit signing
  const token = new Contract(TOKEN, erc20PermitReadAbi, provider);
  const tokenName: string = await token.name();
  const tokenDecimals: number = await token.decimals();
  const tokenNonce: bigint = await token.nonces(ownerAddr);

  // --- amounts
  const amount = parseUnits(AMOUNT_TOKEN, tokenDecimals);
  const feeAmount = parseUnits(FEE_TOKEN, tokenDecimals);
  const pullAmount = amount + feeAmount; // quello che il bundler preleva dall'EOA

  // --- deadlines
  const now = BigInt(Math.floor(Date.now() / 1000));
  const permitDeadline = now + 300n; // 5 minuti
  const execDeadline = now + 300n;

  // =========================================================
  // 1) Build + SIGN PERMIT (spender = BUNDLER)
  // Domain per EIP-2612 (OZ ERC20Permit usa version "1")
  const permitDomain = {
    name: tokenName,
    version: "1",
    chainId,
    verifyingContract: TOKEN,
  };

  const permitMessage = {
    owner: ownerAddr,
    spender: BUNDLER,
    value: pullAmount,
    nonce: tokenNonce,
    deadline: permitDeadline,
  };

  const permitSigRaw = await user.signTypedData(permitDomain, PERMIT_TYPES as any, permitMessage as any);
  const permitSig = Signature.from(permitSigRaw);

  // =========================================================
  // 2) Build + SIGN EXECUTE (ProxyWallet meta-tx)
  // Call: token.transfer(DESTINATION, amount)
  const erc20Iface = new Interface([
    "function transfer(address to, uint256 amount) returns (bool)"
  ]);
  const data = erc20Iface.encodeFunctionData("transfer", [DESTINATION, amount]);

  // IMPORTANT: executor deve essere BUNDLER (perché sarà lui a chiamare executeWithSig)
  const executeReq = {
    call: {
      to: TOKEN,
      value: 0n,
      data,
      operation: 0,
    },
    nonce: walletNonce,
    deadline: execDeadline,
    executor: BUNDLER,
    feeToken: TOKEN,
    feeAmount: feeAmount,
    feeRecipient: RELAYER_ADDR, // il wallet pagherà fee al relayer in token
  };

  const execSig = await user.signTypedData(
    domain(chainId, WALLET_ADDRESS),
    { Call: types.Call, Execute: types.Execute } as any,
    executeReq as any
  );

  // =========================================================
  // 3) Send packaged payload to relayer (relayer -> Bundler -> Wallet)
  const payload = {
    token: TOKEN,
    owner: ownerAddr,
    proxyWallet: WALLET_ADDRESS,

    pullAmount: pullAmount.toString(),
    permitDeadline: permitDeadline.toString(),
    permitSig: {
      v: permitSig.v,
      r: permitSig.r,
      s: permitSig.s,
    },

    exec: {
      call: {
        to: executeReq.call.to,
        value: executeReq.call.value.toString(),
        data: executeReq.call.data,
        operation: executeReq.call.operation,
      },
      nonce: executeReq.nonce.toString(),
      deadline: executeReq.deadline.toString(),
      executor: executeReq.executor,
      feeToken: executeReq.feeToken,
      feeAmount: executeReq.feeAmount.toString(),
      feeRecipient: executeReq.feeRecipient,
    },
    execSig,

    bundler: BUNDLER, // opzionale: ridondante, ma comodo lato relayer
  };

  const resp = await fetch(`${RELAYER_URL}/bundleExecute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  // leggi una sola volta
  const raw = await resp.text();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  console.log(parsed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
