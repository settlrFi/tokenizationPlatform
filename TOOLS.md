# TOOLS.md - operator commands

## Core Repo Commands

Root:
```bash
npm run compile
npm run test
```

Local chain:
```bash
npx hardhat node
```

Typical deploy flow:
```bash
node scripts/00_deploy-implementations.js
node scripts/01_deploy-compliance-proxy.js
node scripts/02_deploy-oracle.js
node scripts/03_create-token-proxies.js
node scripts/04_deploy-market-proxy.js
node scripts/05_list-tokens.js
```

Alternative package scripts commonly used:
```bash
npm run deploy:oracle
npm run deploy:market
npm run list:asset
```

## dApp

```bash
cd dApp
npm run dev
npm run build
```

## Where Things Live

- Contracts: `src/`
- Token contracts: `src/tokens/`
- Hardhat scripts: `scripts/`
- Frontend app: `dApp/src/`
- Oracle bot: `oracle-bot/`
- Wallet/relayer helpers: `proxy_wallet/`

## Practical Debug Sequence

When a user reports a failing flow, check in this order:

1. correct network and RPC
2. correct proxy/contract addresses
3. wallet connected with expected role
4. compliance/whitelist/KYC gating
5. allowance and token balances
6. script/env mismatch
7. ABI drift or stale frontend config
