All:
	CFG="hardhat.config.js"; \
	DIR1="./proxy_wallet/contracts/"; \
	DIR2="./src"; \
	BAK="$${CFG}.bak.$$"; \
	cp -f "$$CFG" "$$BAK"; \
	trap 'mv -f "$$BAK" "$$CFG"' EXIT; \
	set_src(){ \
		SRC="$$1" perl -0777 -i -pe 's/(sources\s*:\s*)"[^"]*"/$$1"$$ENV{SRC}"/' "$$CFG"; \
	}; \
	for d in "$$DIR1" "$$DIR2"; do \
		set_src "$$d"; \
		npx hardhat compile; \
	done; \
	npx hardhat run --network localhost scripts/00_deploy-implementations.js; \
	npx hardhat run --network localhost scripts/01_deploy-compliance-proxy.js; \
	npx hardhat run --network localhost scripts/02_deploy-oracle.js; \
	npx hardhat run --network localhost scripts/03_create-token-proxies.js; \
	npx hardhat run --network localhost scripts/04_deploy-market-proxy.js; \
	npx hardhat run --network localhost scripts/05_list-tokens.js; \
	node oracle-bot/bot.mjs --once; \
	npx hardhat run --network localhost scripts/06_grant-oracle-updater.js; \
	npx hardhat run --network localhost proxy_wallet/src/deploy.ts; \
	npx hardhat run --network localhost scripts/grant-inventory-role.ts

server:
	HOST=192.168.253.163 ALLOWED_ORIGINS=http://192.168.253.163:5173 PORT=3000 npx ts-node proxy_wallet/relayer/src/server.ts
