# MEMORY.md

## Workspace Profile

- Project: tokenization
- Domain: tokenized securities, compliance-gated transfers, maker market flows
- Smart contract stack: Solidity, OpenZeppelin upgradeable, Hardhat, ethers v6
- Frontend stack: React + Vite
- Default local network: Hardhat `local`

## Persistent Rules

- Start from repository truth, not assumptions.
- For coding tasks, prefer minimal changes in the touched area.
- For Solidity work, preserve storage layout discipline on upgradeable contracts.
- For frontend work, preserve operator usability and existing navigation unless explicitly asked to redesign.
- For user support, explain concrete flows through wallet, role, contract, and UI layers.
- If a contract call can fail due to role/compliance/allowance/network mismatch, list that failure class explicitly.
- Avoid versioning heavy `vendor/` dependencies when they can be documented instead.
- Keep OpenClaw bootstrap files concise because they are injected into prompt context.

## Domain Facts To Keep Active

- `src/Market.sol` is the secondary-market style contract for listed assets and stable settlement.
- Token contracts live under `src/tokens/`.
- Deployment/ops scripts live under `scripts/`.
- The dApp operator roles include: Compliance, Custodian/Depositary, Admin, Maker, Distributor, Investor, Registry.

## Default Operating Heuristics

- For repo questions: inspect before answering.
- For local setup questions: prefer `npm run compile`, Hardhat scripts, and Vite dev flow.
- For on-chain troubleshooting: reason through role -> address -> allowance -> compliance -> network -> ABI.
- For dApp support: reason through config -> wallet -> provider -> contract address -> role gating -> tx.
