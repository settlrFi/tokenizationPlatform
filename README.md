# Tokenization Platform

Piattaforma per tokenizzazione di asset con:
- contratti Solidity upgradeable
- dApp React/Vite
- market permissioned
- oracle bot
- stack relayer/proxy wallet

## Workspace Agent Files

Il repository include file di bootstrap per l’agente workspace:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `TOOLS.md`
- `DAPP_RUNBOOK.md`
- `HEARTBEAT.md`

Servono a guidare un agente embedded su:
- modifiche Solidity e dApp con vincoli repo-specifici
- supporto ai flussi locali Hardhat
- spiegazioni operative concrete della piattaforma

## Installazione

Root:
```bash
npm i
```

dApp:
```bash
cd dApp
npm i
```

## Flusso Locale

Terminale 1, blockchain locale:
```bash
npx hardhat node
```

Terminale 2, bootstrap completo locale:
```bash
make local
```

Terminale 3, relayer server:
```bash
make server
```

### Cosa Fa `make local`

Il target `make local`:
- compila `proxy_wallet/contracts` e `src`
- deploya implementation, compliance registry, oracle, token proxies e market su `localhost`
- lista fund ed equities nel market
- esegue `oracle-bot` una volta per seedare i prezzi
- esegue il grant di `UPDATER_ROLE`
- deploya lo stack `proxy_wallet`
- assegna `INVENTORY_ROLE`

### Prerequisiti `make local`

Il target legge `.env`. Se `RPC_URL` non è valorizzata, usa come fallback:
```bash
http://127.0.0.1:8545
```

Esempio minimo:
```bash
RPC_URL="http://127.0.0.1:8545"
PRIVATE_KEY="0x..."
```

## Oracle Bot

Esecuzione manuale singola:
```bash
node oracle-bot/bot.mjs --once
```

Fallback supportati se Yahoo Finance non risponde:
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

Nota:
- `ISP.MI` usa un prezzo EUR che viene convertito in USD tramite `EURUSD`

## dApp

Avvio in sviluppo:
```bash
cd dApp
npm run dev
```

Build:
```bash
cd dApp
npm run build
```

## Backend Chat Workspace

Avvio backend embedded chat:
```bash
npm run agent:server
OPENAI_API_KEY=... npm run agent:server
```

Note:
- la dApp chiama `POST /ai/workspace-agent/chat`
- in dev `dApp/vite.config.js` proxya `/ai/*` verso `http://127.0.0.1:8787`
- se `OPENAI_API_KEY` è presente, il backend usa OpenAI
- altrimenti va in fallback su `codex`
- per il fallback Codex serve `codex login --device-auth` con lo stesso utente OS che avvia il backend

## Deploy Sepolia

Deploy completo contratti principali:
```bash
make sepolia
```

Deploy solo stack gasless/relayer:
```bash
make sepolia-relayer
```

Variabili richieste tipiche:
```bash
SEPOLIA_RPC_URL="https://..."
SEPOLIA_PRIVATE_KEY="0x..."
```

Se l’updater oracle non coincide col deployer:
```bash
SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY="0x..."
```

Template disponibili:
- `.env.sepolia.example`
- `dApp/.env.sepolia.example`

## Ngrok

Installazione:
```bash
sudo snap install ngrok
ngrok config add-authtoken <your-token>
```

Tunnel porta 5173:
```bash
ngrok http 5173
```

## Prompt Loading Order

Ordine consigliato di lettura per l’agente:
1. `SOUL.md`
2. `USER.md`
3. `MEMORY.md`
4. `AGENTS.md`
5. `TOOLS.md`
6. `DAPP_RUNBOOK.md` quando serve supporto operativo sulla piattaforma

## Beacon Architecture

L’obiettivo è separare:
- logica di business
- stato dei singoli token

in modo da consentire upgrade globali della logica senza cambiare gli indirizzi on-chain dei token.

### Componenti

1. `Implementation`
   Contiene la logica del token.
2. `Beacon`
   Mantiene il puntatore all’implementation corrente.
3. `BeaconProxy`
   Un proxy per ogni token/fondo/share class, con storage proprio.

### Effetto

Ogni proxy:
- mantiene il proprio storage
- delega la logica alla implementation puntata dal beacon

L’upgrade globale avviene aggiornando il beacon, non i singoli proxy.
