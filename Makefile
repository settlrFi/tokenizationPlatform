.PHONY: all local sepolia sepolia-resume sepolia-relayer server server\:sepolia stack\:sepolia

all: local

local:
	@NETWORK=localhost MAKE_TARGET=local bash -lc '\
		set -euo pipefail; \
		read_env(){ \
			node scripts/read-env.cjs .env "$$1"; \
		}; \
		DIR1="./proxy_wallet/contracts/"; \
		DIR2="./src"; \
		ORACLE_RPC="$${RPC_URL:-$$(read_env RPC_URL)}"; \
		ORACLE_PK="$${ORACLE_BOT_PRIVATE_KEY:-$${PRIVATE_KEY:-$$(read_env PRIVATE_KEY)}}"; \
		if [ -z "$$ORACLE_RPC" ]; then ORACLE_RPC="http://127.0.0.1:8545"; fi; \
		for d in "$$DIR1" "$$DIR2"; do \
			HARDHAT_SOURCES="$$d" npx hardhat compile; \
		done; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/00_deploy-implementations.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/01_deploy-compliance-proxy.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/02_deploy-oracle.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/03_create-token-proxies.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/04_deploy-market-proxy.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/05_list-tokens.js; \
		RPC_URL="$$ORACLE_RPC" PRIVATE_KEY="$$ORACLE_PK" node oracle-bot/bot.mjs --once; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/06_grant-oracle-updater.js; \
		HARDHAT_SOURCES="$$DIR1" npx hardhat compile; \
		HARDHAT_SOURCES="$$DIR1" npx hardhat run --network "$$NETWORK" proxy_wallet/src/deploy.ts; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat compile; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/grant-inventory-role.ts; \
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
		DIR1="./proxy_wallet/contracts/"; \
		DIR2="./src"; \
		ORACLE_RPC="$${SEPOLIA_RPC_URL:-$${RPC_URL:-$$(read_env SEPOLIA_RPC_URL)}}"; \
		if [ -z "$$ORACLE_RPC" ]; then ORACLE_RPC="$$(read_env RPC_URL)"; fi; \
		ORACLE_PK="$${ORACLE_BOT_PRIVATE_KEY:-$${SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY:-$${SEPOLIA_PRIVATE_KEY:-$${PRIVATE_KEY:-$$(read_env ORACLE_BOT_PRIVATE_KEY)}}}}"; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY)"; fi; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env SEPOLIA_PRIVATE_KEY)"; fi; \
		if [ -z "$$ORACLE_PK" ]; then ORACLE_PK="$$(read_env PRIVATE_KEY)"; fi; \
		for d in "$$DIR1" "$$DIR2"; do \
			HARDHAT_SOURCES="$$d" npx hardhat compile; \
		done; \
		test -n "$$ORACLE_RPC" || { echo "Missing SEPOLIA_RPC_URL (or RPC_URL)"; exit 1; }; \
		test -n "$$ORACLE_PK" || { echo "Missing ORACLE_BOT_PRIVATE_KEY / SEPOLIA_ORACLE_UPDATER_PRIVATE_KEY / SEPOLIA_PRIVATE_KEY"; exit 1; }; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/00_deploy-implementations.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/01_deploy-compliance-proxy.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/02_deploy-oracle.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/03_create-token-proxies.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/04_deploy-market-proxy.js; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/05_list-tokens.js; \
		RPC_URL="$$ORACLE_RPC" PRIVATE_KEY="$$ORACLE_PK" node oracle-bot/bot.mjs --once; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/06_grant-oracle-updater.js; \
		HARDHAT_SOURCES="$$DIR1" npx hardhat compile; \
		HARDHAT_SOURCES="$$DIR1" npx hardhat run --network "$$NETWORK" proxy_wallet/src/deploy.ts; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat compile; \
		HARDHAT_SOURCES="$$DIR2" npx hardhat run --network "$$NETWORK" scripts/grant-inventory-role.ts; \
		echo "Sepolia deploy completed. If you also need the gasless proxy wallet stack, run: make sepolia-relayer"; \
	'

sepolia-resume: sepolia

sepolia-relayer:
	@NETWORK=sepolia bash -lc '\
		set -euo pipefail; \
		if [ -f .env.sepolia.local ]; then set -a; . ./.env.sepolia.local; set +a; fi; \
		export ROOT_ENV_FILE=".env.sepolia.local"; \
		export DAPP_ENV_FILE="dApp/.env.sepolia.local"; \
		HARDHAT_SOURCES="./proxy_wallet/contracts/" npx hardhat compile; \
		HARDHAT_SOURCES="./proxy_wallet/contracts/" npx hardhat run --network "$$NETWORK" proxy_wallet/src/deploy.ts; \
	'

server:
	npx ts-node proxy_wallet/relayer/src/server.ts
	#HOST=192.168.253.163 ALLOWED_ORIGINS=http://192.168.253.163:5173 PORT=3000 npx ts-node proxy_wallet/relayer/src/server.ts

server\:sepolia:
	@bash -lc '\
		set -euo pipefail; \
		read_env(){ \
			node scripts/read-env.cjs "$$1" "$$2"; \
		}; \
		is_template(){ \
			case "$$1" in \
				""|*YOUR_KEY*|*YOUR_*|0xYOUR_*|YOUR_*) return 0 ;; \
				*) return 1 ;; \
			esac; \
		}; \
		ROOT_ENV=".env"; \
		SEPOLIA_ENV=".env.sepolia.local"; \
		get_first(){ \
			for key in "$$@"; do \
				if [ "$$key" = "__ROOT__" ]; then continue; fi; \
				if [ -f "$$SEPOLIA_ENV" ]; then \
					val="$$(read_env "$$SEPOLIA_ENV" "$$key")"; \
					if [ -n "$$val" ] && ! is_template "$$val"; then printf "%s" "$$val"; return 0; fi; \
				fi; \
				if [ -f "$$ROOT_ENV" ]; then \
					val="$$(read_env "$$ROOT_ENV" "$$key")"; \
					if [ -n "$$val" ] && ! is_template "$$val"; then printf "%s" "$$val"; return 0; fi; \
				fi; \
			done; \
			return 1; \
		}; \
		export RPC_URL="$${SEPOLIA_RPC_URL:-$${RPC_URL:-$$(get_first SEPOLIA_RPC_URL RPC_URL || true)}}"; \
		export RELAYER_PRIVATE_KEY="$${SEPOLIA_PRIVATE_KEY:-$$(get_first SEPOLIA_PRIVATE_KEY RELAYER_PRIVATE_KEY PRIVATE_KEY || true)}"; \
		export FACTORY="$${FACTORY:-$$(get_first FACTORY || true)}"; \
		export BUNDLER="$${BUNDLER:-$$(get_first BUNDLER || true)}"; \
		export TOKEN="$${TOKEN:-$$(get_first TOKEN STABLE_ADDRESS || true)}"; \
		export RELAYER_ADDR="$${RELAYER_ADDR:-$$(get_first RELAYER_ADDR ORACLE_UPDATER_ADDRESS || true)}"; \
		export FIXED_FEE="$${FIXED_FEE:-$$(get_first FIXED_FEE VITE_FIXED_FEE_RAW || true)}"; \
		if [ -z "$$RELAYER_ADDR" ] && [ -n "$$RELAYER_PRIVATE_KEY" ]; then \
			export RELAYER_ADDR="$$(node -e "const { Wallet } = require('ethers'); console.log(new Wallet(process.argv[1]).address)" "$$RELAYER_PRIVATE_KEY")"; \
		fi; \
		export ALLOWED_ORIGINS="$${ALLOWED_ORIGINS:-http://localhost:5173}"; \
		export HOST="$${HOST:-0.0.0.0}"; \
		export PORT="$${PORT:-3000}"; \
		test -n "$$RPC_URL" || { echo "Missing SEPOLIA_RPC_URL (or RPC_URL)"; exit 1; }; \
		test -n "$$RELAYER_PRIVATE_KEY" || { echo "Missing RELAYER_PRIVATE_KEY or SEPOLIA_PRIVATE_KEY"; exit 1; }; \
		test -n "$${FACTORY:-}" || { echo "Missing FACTORY for proxy wallet relayer"; exit 1; }; \
		test -n "$${BUNDLER:-}" || { echo "Missing BUNDLER for proxy wallet relayer"; exit 1; }; \
		test -n "$${TOKEN:-}" || { echo "Missing TOKEN for proxy wallet relayer"; exit 1; }; \
		test -n "$${RELAYER_ADDR:-}" || { echo "Missing RELAYER_ADDR for proxy wallet relayer"; exit 1; }; \
		test -n "$${FIXED_FEE:-}" || { echo "Missing FIXED_FEE for proxy wallet relayer"; exit 1; }; \
		npx ts-node proxy_wallet/relayer/src/server.ts; \
	'

stack\:sepolia:
	@bash -lc '\
		set -euo pipefail; \
		cleanup(){ \
			code=$$?; \
			jobs -p | xargs -r kill 2>/dev/null || true; \
			wait || true; \
			exit $$code; \
		}; \
		trap cleanup INT TERM EXIT; \
		echo "[stack:sepolia] starting relayer on Sepolia..."; \
		$(MAKE) --no-print-directory server\:sepolia & \
		echo "[stack:sepolia] starting AI chat backend..."; \
		npm run agent:server & \
		echo "[stack:sepolia] starting dApp on Sepolia..."; \
		cd dApp && npm run dev:sepolia; \
	'
