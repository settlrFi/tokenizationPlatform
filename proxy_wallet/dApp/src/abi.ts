export const FACTORY_ABI = [
  "function predictWallet(address owner) view returns (address)"
] as const;

export const PROXY_WALLET_READ_ABI = [
  "function nonce() view returns (uint256)"
] as const;

export const ERC20_PERMIT_READ_ABI = [
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address owner) view returns (uint256)"
] as const;

export const ERC20_IFACE_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)"
] as const;


export const ERC20_READ_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
] as const;
