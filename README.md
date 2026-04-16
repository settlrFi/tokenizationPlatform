# Tokenization Platform

Open-source tokenization platform with:
- upgradeable Solidity contracts
- a React/Vite operator dApp
- a permissioned market
- an oracle bot
- a proxy-wallet / relayer stack

## Repository Layout

- `src/`: core contracts and token contracts
- `scripts/`: deployment and operational scripts
- `dApp/`: operator console
- `proxy_wallet/`: proxy wallet contracts, relayer, and support scripts
- `oracle-bot/`: price updater bot
- `deployments/`: exported deployed addresses

## Environment Files

This repository uses env files as the source of truth for deployed contract addresses.

Keep these files populated with the addresses produced by your latest deployment:

- root local: [`.env`](/home/frataran/Desktop/projects/tokenizationPlatform/.env)
- root Sepolia: [`.env.sepolia.local`](/home/frataran/Desktop/projects/tokenizationPlatform/.env.sepolia.local)
- dApp local: [dApp/.env](/home/frataran/Desktop/projects/tokenizationPlatform/dApp/.env)
- dApp Sepolia: `dApp/.env.sepolia.local`

At minimum, keep these address variables updated after each deploy:

- `FACTORY_ADDRESS`
- `COMPLIANCE_REGISTRY`
- `ORACLE_ADDRESS`
- `STABLE_ADDRESS`
- `FUND_ADDRESS`
- `AAPL_ADDRESS`
- `MSFT_ADDRESS`
- `ISP_MI_ADDRESS`
- `MARKET_ADDRESS`

For the frontend, the matching `VITE_*` values must also be set:

- `VITE_MARKET_ADDRESS`
- `VITE_ORACLE_ADDRESS`
- `VITE_COMPLIANCE_REGISTRY`
- `VITE_STABLE_ADDRESS`
- `VITE_FUND_ADDRESS`
- `VITE_AAPL_ADDRESS`
- `VITE_MSFT_ADDRESS`
- `VITE_ISP_MI_ADDRESS`
- `VITE_FACTORY`
- `VITE_SECURITY_TOKEN_FACTORY`

Public Sepolia addresses can also be read from:

- [deployments/sepolia.addresses.json](/home/frataran/Desktop/projects/tokenizationPlatform/deployments/sepolia.addresses.json)
- [deployments.sepolia.json](/home/frataran/Desktop/projects/tokenizationPlatform/deployments.sepolia.json)

## Install

Root:

```bash
npm install
```

dApp:

```bash
cd dApp
npm install
```

## Local Development

Start a local Hardhat node:

```bash
npx hardhat node
```

Bootstrap the full local stack:

```bash
make local
```

Start the relayer:

```bash
make server
```

Start the dApp:

```bash
cd dApp
npm run dev
```

## Sepolia

Run or resume the main deployment:

```bash
make sepolia-resume
```

Deploy the proxy-wallet / relayer stack:

```bash
make sepolia-relayer
```

Start the Sepolia relayer:

```bash
make server:sepolia
```

Start the Sepolia dApp:

```bash
cd dApp
npm run dev:sepolia
```

## Oracle Bot

Run a single price update:

```bash
node oracle-bot/bot.mjs --once
```

Useful fallback configuration:

```bash
PRICE_FETCH_TIMEOUT_MS=8000
PRICE_FETCH_RETRIES=2
EURUSD_FALLBACK=1.08
PRICE_FALLBACKS="AAPL=200,MSFT=350,ISP.MI=7"
```

## Notes

- The root env files are operational config files and must contain the currently deployed contract addresses.
- The dApp env files must mirror the deployed addresses with `VITE_*` keys, otherwise the UI will read the wrong contracts.
- If you update addresses, restart both the relayer and the dApp.
- Sepolia private keys and RPC credentials should be replaced locally before publishing or sharing your own fork.
