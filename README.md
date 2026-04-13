# Deploy Market

## OpenClaw Agent

This repository now includes an OpenClaw-oriented workspace bootstrap:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `TOOLS.md`
- `DAPP_RUNBOOK.md`
- `HEARTBEAT.md`

These files are intended to shape an embedded workspace agent so it can:
- modify Solidity contracts and dApp code with repo-specific constraints
- support localhost/Hardhat operational flows
- explain concretely how to use each operator area of the dApp

Embedded chat backend:
```bash
npm run agent:server
OPENAI_API_KEY=... npm run agent:server
```

Notes:
- the dApp chat calls `POST /ai/workspace-agent/chat`
- in dev, `dApp/vite.config.js` proxies `/ai/*` to `http://127.0.0.1:8787`
- if `OPENAI_API_KEY` is set, the backend uses OpenAI; otherwise it falls back to local `codex`
- for Codex fallback, run `codex login --device-auth` with the same OS user that starts the backend

Recommended prompt-loading order:
1. `SOUL.md`
2. `USER.md`
3. `MEMORY.md`
4. `AGENTS.md`
5. `TOOLS.md`
6. `DAPP_RUNBOOK.md` when the user asks how to use the platform

Install:
```bash
npm i
```

Run local blockchain:
```bash
npx hardhat node
```

In other terminal run:
```bash
make
npx ts-node proxy_wallet/relayer/src/server.ts
```

# dApp

Install:
```bash
cd dApp/
npm i
# To run
npm run dev
```

# Public Site Online

Install ngrok
```bash
sudo snap install ngrok
# put the token account
ngrok config add-authtoken 35qZu3jq7iAyl8aW7rKYaJaCIX6_3YfYJH3ViyVrrLjt419Cy
```

Tunnel the port 5173 with ngrok:
```bash
ngrok http 5173
```

The link will be [repercussively-runtgenologic-jesica](https://repercussively-runtgenologic-jesica.ngrok-free.dev) or similar.




# Beacon Architecture


L’obiettivo è separare in modo netto:
- **logica di business (regole, compliance, flussi regolamentari)**  
- **stato dei singoli token (bilanci, lock, metadata, ruoli)**  

consentendo **upgrade globali della logica** senza cambiare gli indirizzi on-chain delle singole “monete”.

---

## Architettura generale

Il sistema utilizza il **Beacon Proxy Pattern**, composto da tre elementi fondamentali:

1. **Implementation (`SecurityToken`)**  
   Contiene tutta la logica del token (ERC20, compliance, propose/authorize mint & burn, locking, LMT, ecc.).

2. **Beacon (`UpgradeableBeacon`)**  
   Contratto centrale che mantiene l’indirizzo dell’implementation corrente.

3. **Proxy (`BeaconProxy`)**  
   Un proxy per ogni token / fondo / share class.  
   Ogni proxy:
   - ha il proprio storage
   - delega l’esecuzione delle funzioni all’implementation indicata dal beacon


---

## Concetti chiave

### Implementation
- È **unica** per tutto il sistema.
- Contiene solo **codice**, non dati persistenti.
- È protetta con `_disableInitializers()` per evitare utilizzi diretti.

### Beacon
- Mantiene **un solo puntatore** alla implementation attiva.
- L’upgrade globale avviene aggiornando questo puntatore.
- È controllato da un owner (tipicamente multisig / timelock).

### BeaconProxy
- Ogni proxy rappresenta **un token distinto**.
- Ha il proprio storage:
  - bilanci
  - ruoli
  - registry
  - metadata
  - locking e LMT
- È l’indirizzo da usare nel frontend, nel market e nei contratti esterni.

---

## Flusso di deploy

### 1. Deploy dell’implementation
Si deploya una sola volta il contratto `SecurityToken`.

const SecurityToken = await ethers.getContractFactory("SecurityToken");
const implementation = await SecurityToken.deploy();

### 1. Deploy del Beacon

const Beacon = await ethers.getContractFactory("UpgradeableBeacon");
const beacon = await Beacon.deploy(implementation.address);

### Creazione di un nuovo token (BeaconProxy)

const initData = SecurityToken.interface.encodeFunctionData(
  "initialize",
  [
    "Fondo Azionario Europa",
    "FAEUR",
    admin,
    complianceOfficer,
    registry
  ]
);

const BeaconProxy = await ethers.getContractFactory("BeaconProxy");
const tokenProxy = await BeaconProxy.deploy(
  beacon.address,
  initData
);


### Come funzionano le chiamate

Quando un utente chiama una funzione (es. proposeMint) sul proxy:

1. La chiamata arriva al BeaconProxy

2. Il proxy chiede al Beacon l’indirizzo dell’implementation

3. Il proxy esegue delegatecall verso l’implementation

4. Il codice viene eseguito usando lo storage del proxy

5. Gli eventi vengono emessi dall’indirizzo del proxy


### Aggiornamento globale della logica

await beacon.upgradeTo(newImplementation.address);
