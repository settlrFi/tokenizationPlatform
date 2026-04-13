import "dotenv/config";
import fetch from "node-fetch";
import { JsonRpcProvider, Wallet, Interface, Contract, parseEther } from "ethers";
import { domain, types } from "../src/eip712";

const RPC_URL = process.env.RPC_URL!;
const USER_PK = process.env.USER_PRIVATE_KEY!;         // chiave investor
const WALLET_ADDRESS = process.env.PROXY_WALLET!;      // address del ProxyWallet (utente)
const RELAYER_URL = process.env.RELAYER_URL!;          // es. http://localhost:3000
const RELAYER_ADDR = process.env.RELAYER_ADDR!;        // address del relayer (per executor)

const proxyWalletAbi = [
  "function nonce() view returns (uint256)",
] as const;

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const user = new Wallet(USER_PK, provider);
  const { chainId } = await provider.getNetwork();

  const w = new Contract(WALLET_ADDRESS, proxyWalletAbi, provider);
  const nonce: bigint = await w.nonce();

  const amountWei = parseEther('0.01');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minuti

  const DESTINATION = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";


  // Meta-tx: invia ETH a DESTINATION
  const executeReq = {
    call: {
      to: DESTINATION,
      value: amountWei,
      data: "0x",
      operation: 0, // CALL
    },
    nonce,
    deadline,
    executor: RELAYER_ADDR, // vincola al tuo relayer
    // fee ZERO
    feeToken: "0x0000000000000000000000000000000000000000",
    feeAmount: 0n,
    feeRecipient: RELAYER_ADDR,
  };

  const sig = await user.signTypedData(
    domain(chainId, WALLET_ADDRESS),
    { Call: types.Call, Execute: types.Execute } as any,
    executeReq as any
  );

  const resp = await fetch(`${RELAYER_URL}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: WALLET_ADDRESS,
      request: {
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
      signature: sig,
    }),
  });


  console.log(await resp.json());

  // Esempio: ERC20 approve (USDC) dal wallet verso uno spender
  const usdc = "0x...";      // token address
  const spender = RELAYER_ADDR;   // spender
  const amount = 1_000_000n; // 1 USDC se 6 decimali

  

  // nonce del proxy wallet (on-chain)
  // NB: qui semplifico: tu puoi leggere nonce dal wallet via provider+call (serve ABI completo o minimal)
  // Per brevità: mettiamo manuale o usa Contract(nonce()) come nel relayer.
  // Suggerito: leggere nonce con ethers.Contract.
  // ----
  // const nonce = 0n; // sostituisci con lettura on-chain reale
  // ----

  

  

  console.log(await resp.json());
  
}

main().catch(console.error);
