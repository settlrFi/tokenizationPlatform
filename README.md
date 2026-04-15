# Tokenization Platform

Asset tokenization platform with:
- upgradeable Solidity contracts
- React/Vite dApp
- permissioned market
- oracle bot
- relayer/proxy wallet stack

## Workspace Agent Files

This repository includes bootstrap files for the workspace agent:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `TOOLS.md`
- `DAPP_RUNBOOK.md`
- `HEARTBEAT.md`

They are used to guide an embedded agent on:
- Solidity and dApp changes with repo-specific constraints
- local Hardhat workflows
- concrete operational support for the platform

## Installation

Root:
```bash
npm i
```

dApp:
```bash
cd dApp
npm i
```

## Local Flow

Terminal 1, local blockchain:
```bash
npx hardhat node
```

Terminal 2, full local bootstrap:
```bash
make local
```

Terminal 3, relayer server:
```bash
make server
```

### What `make local` does

The `make local` target:
- compiles `proxy_wallet/contracts` and `src`
- deploys implementations, compliance registry, oracle, token proxies, and market on `localhost`
- lists the fund and equities in the market
- runs `oracle-bot` once to seed prices
- grants `UPDATER_ROLE`
- deploys the `proxy_wallet` stack
- grants `INVENTORY_ROLE`

### `make local` prerequisites

The target reads `.env`. If `RPC_URL` is not set, it falls back to:
```bash
http://127.0.0.1:8545
```

Minimal example:
```bash
RPC_URL="http://127.0.0.1:8545"
PRIVATE_KEY="0x..."
```

## Oracle Bot

Single manual run:
```bash
node oracle-bot/bot.mjs --once
```

Supported fallbacks if Yahoo Finance does not respond:
```bash
PRICE_FETCH_TIMEOUT_MS=8000
PRICE_FETCH_RETRIES=2
EURUSD_FALLBACK=1.08
PRICE_FALLBACKS="AAPL=200,MSFT=350,ISP.MI=7"
```

Sono supportati anche fallback puntuali per simbolo:
```bash
AAPL_PRICE=200
MSFT_PRICE=350
ISP_MI_PRICE=7
```

Note:
- `ISP.MI` uses a EUR price that is converted to USD through `EURUSD`

## dApp

Development start:
```bash
cd dApp
npm run dev
```

Build:
```bash
cd dApp
npm run build
```

Development start on Sepolia:
```bash
cd dApp
npm run dev:sepolia
```

## Backend Chat Workspace

Embedded chat backend start:
```bash
npm run agent:server
OPENAI_API_KEY=... npm run agent:server
```

Notes:
- the dApp calls `POST /ai/workspace-agent/chat`
- in dev, `dApp/vite.config.js` proxies `/ai/*` to `http://127.0.0.1:8787`
- if `OPENAI_API_KEY` is present, the backend uses OpenAI
- otherwise it falls back to `codex`
- for the Codex fallback, run `codex login --device-auth` with the same OS user that starts the backend

## Deploy Sepolia

Full main-contract deployment:
```bash
make sepolia
```

Deploy only the gasless/relayer stack:
```bash
make sepolia-relayer
```

Resume an interrupted deployment:
```bash
make sepolia-resume
```

Typical required variables:
```bash
SEPOLIA_RPC_URL="https://..."
SEPOLIA_PRIVATE_KEY="0x..."
```

If the oracle updater is not the deployer:
```bash
SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY="0x..."
```

Available templates:
- `.env.sepolia.example`
- `dApp/.env.sepolia.example`

### dApp + Relayer su Sepolia

Minimal practical flow:
```bash
make sepolia-resume
make sepolia-relayer
make server:sepolia
cd dApp
npm run dev:sepolia
```

What `make server:sepolia` does:
- loads `.env` and then `.env.sepolia.local`
- forces `RPC_URL` to `SEPOLIA_RPC_URL`
- uses `SEPOLIA_PRIVATE_KEY` as a fallback for `RELAYER_PRIVATE_KEY`
- starts `proxy_wallet/relayer/src/server.ts` on port `3000`
- requires `FACTORY`, `BUNDLER`, `TOKEN`, `RELAYER_ADDR`, and `FIXED_FEE` to be set

Operational notes:
- the Sepolia dApp reads `dApp/.env.sepolia.local`
- the Sepolia relayer reads the variables exported by `make server:sepolia`
- for the gasless Investor flow, `VITE_FACTORY` must point to the `ProxyWalletFactory`, not the `SecurityTokenBeaconFactory`
- if you change env values or complete a new deployment, restart both `make server:sepolia` and `npm run dev:sepolia`

### Sepolia operating wallet

In this simplified Sepolia setup, the wallet:
```text
0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c
```
is used as:
- deployer
- relayer
- compliance officer
- oracle updater
- maker
- depositary
- platform
- treasury
- corporate action operator

This is only for operational simplicity on Sepolia. In a more realistic setup, these roles should be assigned to separate wallets.

### How to use the dApp on Sepolia

Prerequisites:
- MetaMask connected to Sepolia (`chainId = 11155111`)
- dApp started with `npm run dev:sepolia`
- relayer started with `make server:sepolia` if you use the gasless Investor flow
- Sepolia deployment already completed or resumed with `make sepolia-resume`

With wallet `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`, in this specific setup, you can use all main operator pages of the platform:
- `Compliance`: whitelist and KYC
- `Custodian`: authorize mint / authorize burn
- `Admin`: operational configuration and infrastructure control
- `Maker`: inventory and market operations
- `Distributor`: transfers to operational or investor wallets
- `Investor`: position reads and proxy wallet/relayer flow
- `Registry`: event and state inspection

In the gasless `Investor` flow:
- the relayer uses `FACTORY`, `BUNDLER`, `TOKEN`, and `RELAYER_ADDR`
- the proxy wallet is predicted or created through `ProxyWalletFactory`
- the token used for fee and pull is `mUSD` (`TOKEN` / `VITE_MUSD`)
- if the proxy wallet or the relayer are not compliant/whitelisted, token transfers may revert

## Ngrok

Installation:
```bash
sudo snap install ngrok
ngrok config add-authtoken <your-token>
```

Tunnel port 5173:
```bash
ngrok http 5173
```

## Prompt Loading Order

Recommended reading order for the agent:
1. `SOUL.md`
2. `USER.md`
3. `MEMORY.md`
4. `AGENTS.md`
5. `TOOLS.md`
6. `DAPP_RUNBOOK.md` when operational platform support is needed

## Beacon Architecture

The goal is to separate:
- business logic
- per-token state

This allows global logic upgrades without changing the on-chain addresses of the tokens.

### Components

1. `Implementation`
   Contains the token logic.
2. `Beacon`
   Stores the pointer to the current implementation.
3. `BeaconProxy`
   One proxy per token/fund/share class, each with its own storage.

### Effect

Each proxy:
- keeps its own storage
- delegates logic to the implementation referenced by the beacon

The global upgrade happens by updating the beacon, not the individual proxies.
