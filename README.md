# Tokenization Platform

Open-source tokenization platform for regulated digital assets, with:

- upgradeable Solidity contracts
- a React/Vite operator dApp
- a permissioned market
- an oracle updater bot
- a proxy-wallet / relayer stack for gasless flows
- `Seta`, the embedded AI operator agent in the dApp

## Main Entry Point

The main operator experience of this repository is:

```bash
make stack:sepolia
```

This is the primary command to run the full Sepolia stack with:

- the dApp
- the proxy-wallet relayer
- `Seta`, the embedded AI operator agent

Before running it:

1. make sure the Sepolia contracts are already deployed and the env files contain their addresses
2. configure `Seta` with either:
   `OPENAI_API_KEY`
   or `codex login --device-auth`

Once ready, launch:

```bash
make stack:sepolia
```

Then open:

```text
http://localhost:5173
```

## Seta

`Seta` is the core operator agent of the platform.

It is designed to:

- guide operators through tokenization flows
- explain role requirements and contract configuration
- help debug compliance, relayer, wallet, and chain issues
- assist with Solidity, script, and frontend changes directly from the dApp chat

`Seta` runs through the backend service in:

- [backend/ai-agent-server.js](tokenizationPlatform/backend/ai-agent-server.js)

## Architecture

The repository is split into five main layers:

- `src/`: core Solidity contracts, token logic, compliance registry, market
- `scripts/`: deployment, bootstrap, and operational scripts
- `dApp/`: operator console for Admin, Compliance, Depositary, Maker, Investor, and Custodian flows
- `proxy_wallet/`: proxy wallet contracts plus the relayer server used by gasless investor actions
- `backend/`: the `Seta` chat backend exposed to the dApp

Supporting modules:

- `oracle-bot/`: off-chain oracle updater
- `deployments/`: exported deployed addresses for local and Sepolia environments
- `memory/`: optional repo notes when historical context matters

## Infrastructure Model

This platform runs as three coordinated services around the deployed contracts:

1. Smart contracts on the target chain
2. The operator dApp
3. Off-chain services:
   `oracle-bot`, proxy-wallet relayer, and `Seta`

For Sepolia, the recommended runtime is:

- deployed contracts already present on Sepolia
- `.env.sepolia.local` populated with current contract addresses and relayer credentials
- `dApp/.env.sepolia.local` populated with matching `VITE_*` addresses
- `make stack:sepolia` to launch the operator stack in one command

## Repository Layout

- `src/`: core contracts and token contracts
- `scripts/`: deployment and operational scripts
- `dApp/`: operator console
- `proxy_wallet/`: proxy wallet contracts, relayer, and support scripts
- `backend/`: `Seta` backend service
- `oracle-bot/`: price updater bot
- `deployments/`: exported deployed addresses

## Environment Files

Environment files are the source of truth for deployed contract addresses.

Do not remove the env files that contain the local or Sepolia addresses. Keep them aligned with the latest deployment state.

Primary files:

- root local: [`.env`](tokenizationPlatform/.env)
- root Sepolia: [`.env.sepolia.local`](tokenizationPlatform/.env.sepolia.local)
- dApp local: [dApp/.env](tokenizationPlatform/dApp/.env)
- dApp Sepolia: [dApp/.env.sepolia.local](tokenizationPlatform/dApp/.env.sepolia.local)

At minimum, after each deployment keep these contract addresses updated in the root env:

- `FACTORY_ADDRESS`
- `COMPLIANCE_REGISTRY`
- `ORACLE_ADDRESS`
- `STABLE_ADDRESS`
- `FUND_ADDRESS`
- `AAPL_ADDRESS`
- `MSFT_ADDRESS`
- `ISP_MI_ADDRESS`
- `MARKET_ADDRESS`

For the frontend, keep the matching `VITE_*` values updated:

- `VITE_CHAIN_ID`
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
- `VITE_BUNDLER`
- `VITE_RELAYER_ADDR`
- `VITE_MUSD`
- `VITE_MARKET_DEPLOY_BLOCK`

Sepolia addresses can also be verified in:

- [deployments/sepolia.addresses.json](tokenizationPlatform/deployments/sepolia.addresses.json)
- [deployments.sepolia.json](tokenizationPlatform/deployments.sepolia.json)

## Node.js Version

Environment used here:

- `Node.js v25.8.1`

## Install

Root dependencies:

```bash
npm install
```

dApp dependencies:

```bash
cd dApp
npm install
```

## Local Development

Start a local Hardhat node:

```bash
npx hardhat node
```

Bootstrap the local contracts and supporting services:

```bash
make local
```

This local bootstrap compiles and deploys:

- core implementations
- compliance registry
- oracle
- token proxies
- market
- proxy-wallet contracts
- local inventory permissions

It also runs the local oracle seed once during bootstrap.

Start the local relayer:

```bash
make server
```

Start the local `Seta` backend:

```bash
npm run agent:server
```

Start the dApp:

```bash
cd dApp
npm run dev
```

Full local runtime, with all services started manually:

1. start the local node
   ```bash
   npx hardhat node
   ```
2. deploy and bootstrap the local contracts
   ```bash
   make local
   ```
3. start the local proxy-wallet relayer
   ```bash
   make server
   ```
4. start the `Seta` backend
   ```bash
   npm run agent:server
   ```
5. start the dApp
   ```bash
   cd dApp
   npm run dev
   ```

## Sepolia Deployment

Run or resume the main Sepolia deployment:

```bash
make sepolia-resume
```

This deploys or resumes the Solidity contracts defined in this project on Sepolia:

- upgradeable token implementations
- compliance registry
- oracle
- stable, fund, and equity token proxies
- market
- oracle updater permissions
- inventory role wiring

If the run is interrupted, `make sepolia-resume` is the recommended restart path.

Deploy or resume the proxy-wallet / relayer contracts:

```bash
make sepolia-relayer
```

The proxy-wallet deployment covers:

- `ProxyWallet`
- `ProxyWalletFactory`
- `RelayBundler`
- stable-token bootstrap used by the gasless investor flow

Run the Sepolia relayer only:

```bash
make server:sepolia
```

Run the Sepolia dApp only:

```bash
cd dApp
npm run dev:sepolia
```

Full Sepolia runtime, assuming the contracts have already been deployed:

1. deploy or resume the core contracts
   ```bash
   make sepolia-resume
   ```
2. deploy or resume the proxy-wallet stack
   ```bash
   make sepolia-relayer
   ```
3. configure `Seta`
   with `OPENAI_API_KEY` or `codex login --device-auth`
4. start everything together
   ```bash
   make stack:sepolia
   ```

## Seta Backend

The backend entrypoint is:

- [backend/ai-agent-server.js](tokenizationPlatform/backend/ai-agent-server.js)

The service exposes:

- `POST /ai/workspace-agent/chat`
- `GET /ai/workspace-agent/history`
- `GET /health`

By default:

- if `OPENAI_API_KEY` is set, `Seta` uses OpenAI
- otherwise it falls back to the local `codex` CLI

## Configure Seta Before Startup

Before running the full Sepolia stack, decide which backend mode `Seta` should use.

Option 1: OpenAI-backed `Seta`

Set the key in your shell or env before startup:

```bash
export OPENAI_API_KEY=your_key_here
```

Optional model override:

```bash
export OPENAI_AGENT_MODEL=gpt-5-mini
```

Option 2: local Codex-backed `Seta`

Make sure the backend OS user is logged in:

```bash
codex login --device-auth
```

Then verify:

```bash
codex login status
```

If you do not configure either of these correctly, the dApp chat can start but `Seta` will fail to answer requests.

## One-Command Sepolia Stack

Once the Sepolia env files contain the deployed addresses and `Seta` is configured, launch the full operator stack with:

```bash
make stack:sepolia
```

This command starts:

- the Sepolia proxy-wallet relayer on port `3000`
- the `Seta` backend on port `8787`
- the Sepolia dApp via Vite on port `5173`

Then open:

```text
http://localhost:5173
```

If you change any contract address or agent configuration, restart `make stack:sepolia`.

## Live Demo

A live preview of the platform UI can be viewed here:

- https://settlrfi.github.io/

Important limitation:

- this live preview does not include the server-side proxy-wallet relayer
- this live preview does not include the server-side `Seta` AI backend

So the GitHub Pages demo is useful for viewing the interface and the general platform structure, but not for the server-backed relayer or AI-agent flows.

## Using the dApp

The dApp is an operator console. Different pages assume different wallets, roles, and permissions.

### Initial Setup

When the dApp opens:

1. connect the wallet in MetaMask
2. make sure the wallet is on the expected chain
3. open the configuration panel
4. click `Autofill from .env`
5. click `Save configuration`

This loads the frontend with the addresses and runtime config already defined in the env files.

Before using any page, verify:

- the wallet is connected
- the chain id is correct
- the proxy addresses shown in the UI match the deployment
- the connected wallet has the role required by that page

### Sepolia Test Operator Wallet

For this repository setup, the main Sepolia operator wallet used in testing is:

- `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`

In this specific setup, that wallet is used as the simplified all-roles operator for:

- compliance actions
- custodian actions
- admin actions
- maker and inventory actions
- relayer operations

Do not store or publish the private key in the repository or in the `README`.

If you want to use the same wallet locally, place its private key only in your local:

- [`.env.sepolia.local`](tokenizationPlatform/.env.sepolia.local)

In this repository setup, the corresponding Sepolia test private key is expected to be read locally from:

- `SEPOLIA_PRIVATE_KEY` in [`.env.sepolia.local`](tokenizationPlatform/.env.sepolia.local)

and then restart:

```bash
make stack:sepolia
```

### Compliance

Required wallet and role:

- a wallet with `COMPLIANCE_ROLE` on the compliance registry
- in the current Sepolia test setup, `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`

Use this page to:

- whitelist investor wallets
- set or extend KYC expiry
- verify whitelist and KYC status

Common failures:

- wrong compliance registry address
- connected wallet missing `COMPLIANCE_ROLE`
- wrong network
- invalid investor wallet address

### Custodian

Required wallet and role:

- a wallet with `DEPOSITARY_ROLE` on the target token proxy
- in the current Sepolia test setup, `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`

Use this page to:

- authorize mint flows
- authorize burn flows
- complete custodian-side issuance and redemption operations

Common failures:

- missing `DEPOSITARY_ROLE`
- wrong token proxy selected
- incomplete burn parameters

### Admin

Required wallet and role:

- an admin wallet, or a wallet with the required updater role for the action
- in the current Sepolia test setup, `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`

Use this page to:

- manage admin-level infrastructure actions
- manage oracle or NAV-related permissions
- operate constant-NAV style controls where enabled

Common failures:

- using an implementation address instead of a proxy
- wallet missing admin or updater permissions

### Maker

Required wallet and role:

- a wallet with `INVENTORY_ROLE` on `Market`
- in the current Sepolia test setup, `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c`

Use this page to:

- deposit stable inventory
- deposit asset inventory
- withdraw inventory
- propose maker mint and burn flows for later custodian handling

Common failures:

- wallet not granted maker or inventory permissions
- missing token approval
- unlisted asset selection

### Distributor

Required wallet and role:

- the operational wallet configured for distribution and transfer workflows
- in the current Sepolia test setup, use `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c` unless you split roles

Use this page to:

- move stable or asset balances to investor wallets
- propose mint or burn flows for investors

Common failures:

- recipient blocked by compliance
- insufficient balance
- wrong token selected

### Investor

Required wallet and role:

- an investor wallet, or the wallet being tested in investor flows
- for operator-side testing in this setup, `0xD0413151EA1E3088DeC3A3CFA926d993a962fd2c` can also be used

Use this page to:

- inspect listed assets
- inspect wallet balances
- buy from maker inventory
- sell to maker inventory
- transfer stable or assets
- create and use the proxy-wallet / relayer flow

For the gasless path:

- the relayer must be running
- `VITE_FACTORY`, `VITE_BUNDLER`, `VITE_MUSD`, and `VITE_RELAYER_ADDR` must match the deployed contracts

Common failures:

- wrong chain in MetaMask
- stale frontend config because `Autofill from .env` and `Save configuration` were not applied
- investor wallet or proxy wallet not whitelisted
- relayer not running or misconfigured

### Registry

Use this page to:

- inspect historical and live events
- verify emitted logs
- trace market, registry, and token activity across the platform

Use it when:

- a transaction appears successful but UI state looks stale
- you need an audit trail
- you need to verify which contract emitted a given event

## Oracle Bot

Run a continuous price update:

```bash
node oracle-bot/bot.mjs --once
```

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

## Operational Notes

- Root env files must contain the currently deployed contract addresses.
- dApp env files must mirror the same deployment using `VITE_*` keys.
- If addresses drift between root env and dApp env, the UI will read the wrong contracts.
- If the relayer is started with the wrong wallet or wrong env, proxy-wallet flows will fail even if the dApp loads.
- `VITE_CHAIN_ID` and `VITE_MARKET_DEPLOY_BLOCK` must match the deployed target network.
- If you update env values, restart the relayer, `Seta`, and the dApp.

## Security Notes

- Never publish real private keys from your local `.env` files.
- Replace Sepolia RPC credentials and signer keys in your own fork.
- Do not claim a deployment succeeded unless the contracts and addresses are verified in the deployment artifacts or on-chain.
