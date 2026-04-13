import * as fs from "fs";
import * as path from "path";

const ENV_FILENAME = ".env";
const envPath = path.resolve(process.cwd(), ENV_FILENAME);
const proxyWalletDappEnvPath = path.resolve(process.cwd(), "proxy_wallet/dApp/.env.local");
const rootDappEnvPath = path.resolve(process.cwd(), "dApp/.env");
const viteKeyMap: Record<string, string[]> = {
  FACTORY: ["VITE_FACTORY"],
  BUNDLER: ["VITE_BUNDLER"],
  TOKEN: ["VITE_MUSD"],
  RELAYER_ADDR: ["VITE_RELAYER_ADDR"],
  CHAIN_ID: ["VITE_CHAIN_ID"],
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function upsertEnv(filePath: string, key: string, value: string): void {
  let content: string = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

  const safeKey = escapeRegExp(key);
  const line = `${key}="${value}"`;

  const keyRegex = new RegExp(`^${safeKey}=`, "m");
  if (keyRegex.test(content)) {
    content = content.replace(new RegExp(`^${safeKey}=.*$`, "m"), line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += line + "\n";
  }

  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Upserts a KEY="address" line into the .env file in the current working directory.
 */
export default function envAddress(key: string, address: string): void {
  upsertEnv(envPath, key, address);

  const viteKeys = viteKeyMap[key] || [];
  for (const viteKey of viteKeys) {
    try {
      upsertEnv(proxyWalletDappEnvPath, viteKey, address);
    } catch {
      // keep root env as source of truth even if proxy_wallet dApp env is absent
    }
    try {
      upsertEnv(rootDappEnvPath, viteKey, address);
    } catch {
      // keep root env as source of truth even if main dApp env is absent
    }
  }
}
