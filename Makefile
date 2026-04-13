.PHONY: all local sepolia sepolia-relayer server

all: local

local:
	@NETWORK=localhost MAKE_TARGET=local bash -lc '\
		set -euo pipefail; \
		read_env(){ \
			node scripts/read-env.cjs .env "$$1"; \
		}; \
		CFG="hardhat.config.js"; \
		DIR1="./proxy_wallet/contracts/"; \
		DIR2="./src"; \
		ORACLE_RPC="$${RPC_URL:-$$(read_env RPC_URL)}"; \
		ORACLE_PK="$${ORACLE_BOT_PRIVATE_KEY:-$${PRIVATE_KEY:-$$(read_env PRIVATE_KEY)}}"; \
		if [ -z "$$ORACLE_RPC" ]; then ORACLE_RPC="http://127.0.0.1:8545"; fi; \
		BAK="$${CFG}.bak.$$"; \
		cp -f "$$CFG" "$$BAK"; \
		trap "mv -f \"$$BAK\" \"$$CFG\"" EXIT; \
		set_src(){ \
			SRC="$$1" perl -0777 -i -pe '\''s/(sources\s*:\s*)"[^"]*"/$$1"$ENV{SRC}"/'\'' "$$CFG"; \
		}; \
		for d in "$$DIR1" "$$DIR2"; do \
			set_src "$$d"; \
			npx hardhat compile; \
		done; \
		npx hardhat run --network "$$NETWORK" scripts/00_deploy-implementations.js; \
		npx hardhat run --network "$$NETWORK" scripts/01_deploy-compliance-proxy.js; \
		npx hardhat run --network "$$NETWORK" scripts/02_deploy-oracle.js; \
		npx hardhat run --network "$$NETWORK" scripts/03_create-token-proxies.js; \
		npx hardhat run --network "$$NETWORK" scripts/04_deploy-market-proxy.js; \
		npx hardhat run --network "$$NETWORK" scripts/05_list-tokens.js; \
		RPC_URL="$$ORACLE_RPC" PRIVATE_KEY="$$ORACLE_PK" node oracle-bot/bot.mjs --once; \
		npx hardhat run --network "$$NETWORK" scripts/06_grant-oracle-updater.js; \
		npx hardhat run --network "$$NETWORK" proxy_wallet/src/deploy.ts; \
		npx hardhat run --network "$$NETWORK" scripts/grant-inventory-role.ts; \
	'

sepolia:
	@NETWORK=sepolia MAKE_TARGET=sepolia bash -lc '\
		set -euo pipefail; \
		if [ -f .env.sepolia.local ]; then set -a; . ./.env.sepolia.local; set +a; fi; \
		read_env(){ \
			node scripts/read-env.cjs .env.sepolia.local "$$1"; \
		}; \
		export ROOT_ENV_FILE=".env.sepolia.local"; \
		export DAPP_ENV_FILE="dApp/.env.sepolia.local"; \
		CFG="hardhat.config.js"; \
		DIR1="./proxy_wallet/contracts/"; \
		DIR2="./src"; \
		ORACLE_RPC="$${SEPOLIA_RPC_URL:-$${RPC_URL:-$$(read_env SEPOLIA_RPC_URL)}}"; \
		if [ -z "$$ORACLE_RPC" ]; then ORACLE_RPC="$$(read_env RPC_URL)"; fi; \
		ORACLE_PK="$${ORACLE_BOT_PRIVATE_KEY:-$${SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY:-$${SEPOLIA_PRIVATE_KEY:-$${PRIVATE_KEY:-$$(read_env ORACLE_BOT_PRIVATE_KEY)}}}}}"; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY)"; fi; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env SEPOLIA_PRIVATE_KEY)"; fi; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env PRIVATE_KEY)"; fi; \
		BAK="$${CFG}.bak.$$"; \
		cp -f "$$CFG" "$$BAK"; \
		trap "mv -f \"$$BAK\" \"$$CFG\"" EXIT; \
		set_src(){ \
			SRC="$$1" perl -0777 -i -pe '\''s/(sources\s*:\s*)"[^"]*"/$$1"$ENV{SRC}"/'\'' "$$CFG"; \
		}; \
		for d in "$$DIR1" "$$DIR2"; do \
			set_src "$$d"; \
			npx hardhat compile; \
		done; \
		test -n "$$ORACLE_RPC" || { echo "Missing SEPOLIA_RPC_URL (or RPC_URL)"; exit 1; }; \
		test -n "$$ORACLE_PK" || { echo "Missing ORACLE_BOT_PRIVATE_KEY / SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY / SEPOLIA_PRIVATE_KEY"; exit 1; }; \
		npx hardhat run --network "$$NETWORK" scripts/00_deploy-implementations.js; \
		npx hardhat run --network "$$NETWORK" scripts/01_deploy-compliance-proxy.js; \
		npx hardhat run --network "$$NETWORK" scripts/02_deploy-oracle.js; \
		npx hardhat run --network "$$NETWORK" scripts/03_create-token-proxies.js; \
		npx hardhat run --network "$$NETWORK" scripts/04_deploy-market-proxy.js; \
		npx hardhat run --network "$$NETWORK" scripts/05_list-tokens.js; \
		RPC_URL="$$ORACLE_RPC" PRIVATE_KEY="$$ORACLE_PK" node oracle-bot/bot.mjs --once; \
		npx hardhat run --network "$$NETWORK" scripts/06_grant-oracle-updater.js; \
		npx hardhat run --network "$$NETWORK" scripts/grant-inventory-role.ts; \
		echo "Sepolia deploy completed. If you also need the gasless proxy wallet stack, run: make sepolia-relayer"; \
	'

sepolia-relayer:
	@NETWORK=sepolia bash -lc '\
		set -euo pipefail; \
		if [ -f .env.sepolia.local ]; then set -a; . ./.env.sepolia.local; set +a; fi; \
		export ROOT_ENV_FILE=".env.sepolia.local"; \
		export DAPP_ENV_FILE="dApp/.env.sepolia.local"; \
		npx hardhat run --network "$$NETWORK" proxy_wallet/src/deploy.ts; \
	'

server:
	HOST=192.168.253.163 ALLOWED_ORIGINS=http://192.168.253.163:5173 PORT=3000 npx ts-node proxy_wallet/relayer/src/server.ts
