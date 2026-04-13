# DAPP_RUNBOOK.md

## What This dApp Is

This dApp is an operator console for a tokenization stack. It is not a single-user consumer app. Different pages assume different wallets, roles, and permissions.

Main operator areas visible in the UI:
- Compliance
- Custodian
- Admin
- Maker
- Distributor
- Investor
- Registry

## Before Using The dApp

Confirm these prerequisites first:

1. Hardhat node or target RPC is running.
2. Frontend env/config contains the right proxy addresses.
3. Wallet is connected on the expected chain.
4. The connected wallet has the role required by the page being used.
5. The relevant user wallets are whitelisted and have valid KYC expiry when transfers are compliance-gated.

## Concrete Usage Flows

### Compliance Page

Use when you need to whitelist a wallet, set KYC expiry, or verify compliance status.

Steps:
1. Connect a wallet with `COMPLIANCE_ROLE` on the compliance registry.
2. Open `Compliance`.
3. Enter the investor wallet.
4. Apply whitelist and expiry.
5. Verify the state after the transaction confirms.

Common failures:
- wrong registry address
- connected wallet lacks `COMPLIANCE_ROLE`
- wrong chain

### Custodian / Depositary Page

Use when you need to authorize mint or burn flows on token proxies.

Steps:
1. Connect a wallet with `DEPOSITARY_ROLE` on the target token.
2. Open `Custodian`.
3. Select the instrument/token.
4. Execute authorize mint or authorize burn using the correct order id and amounts.

Common failures:
- missing `DEPOSITARY_ROLE`
- wrong token proxy selected
- burn flow missing required parameters such as `netPaid`

### Admin Page

Use when you need to manage admin-level permissions or infrastructure settings such as oracle/operator access.

Common failures:
- using implementation address instead of proxy
- admin wallet mismatch

### Maker Page

Use for market inventory operations.

Steps:
1. Connect a wallet with `INVENTORY_ROLE` on `Market`.
2. Deposit stable or asset inventory.
3. Withdraw inventory when needed.
4. Verify balances in the page after tx confirmation.

Common failures:
- wallet not granted maker/inventory role
- missing token approval before deposit
- using an unlisted asset id

### Distributor Page

Use for moving instruments between operational wallets and investor wallets.

Common failures:
- compliance block on recipient
- insufficient token balance
- wrong token proxy address from market metadata

### Investor Page

Use for end-user style interactions with the listed assets and related balances/status panels.

Common failures:
- proxy wallet or investor wallet not whitelisted
- stale deploy block or stale contract addresses in frontend config
- wrong network in MetaMask

### Registry Page

Use to inspect platform activity and blockchain events across market, registry, and token contracts.

Useful when:
- a transaction allegedly succeeded but UI state looks stale
- you need to inspect emitted events
- you need a cross-contract audit trail

## Support Playbook For The Agent

When a human asks "how do I do X in the dApp?", answer with:

1. which wallet/role is required
2. which page to open
3. what fields to fill
4. what transaction is expected
5. what to verify after confirmation
6. the top 2-4 reasons it may fail
