export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const;

export const TYPES = {
  Call: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }
  ],
  Execute: [
    { name: "call", type: "Call" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "executor", type: "address" },
    { name: "feeToken", type: "address" },
    { name: "feeAmount", type: "uint256" },
    { name: "feeRecipient", type: "address" }
  ]
} as const;

// Deve matchare la tua domain() on-chain/off-chain nel progetto.
// Qui uso name="ProxyWallet" version="1" (coerente con quanto abbiamo usato prima).
export function walletDomain(chainId: number, verifyingContract: string) {
  return { name: "ProxyWallet", version: "1", chainId, verifyingContract };
}

export function permitDomain(chainId: number, tokenName: string, tokenAddress: string) {
  return { name: tokenName, version: "1", chainId, verifyingContract: tokenAddress };
}
