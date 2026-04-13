const fs = require("fs");
const path = require("path");

function rootEnvFile() {
  return process.env.ROOT_ENV_FILE || ".env";
}

function dappEnvFile() {
  return process.env.DAPP_ENV_FILE || "dApp/.env";
}

const VITE_KEY_MAP = {
  CHAIN_ID: ["VITE_CHAIN_ID"],
  MARKET_DEPLOY_BLOCK: ["VITE_MARKET_DEPLOY_BLOCK"],
  MARKET_ADDRESS: ["VITE_MARKET_ADDRESS"],
  STABLE_ADDRESS: ["VITE_STABLE_ADDRESS"],
  ORACLE_ADDRESS: ["VITE_ORACLE_ADDRESS"],
  FUND_ADDRESS: ["VITE_FUND_ADDRESS"],
  COMPLIANCE_REGISTRY: ["VITE_COMPLIANCE_REGISTRY"],
  FACTORY_ADDRESS: ["VITE_FACTORY", "VITE_SECURITY_TOKEN_FACTORY"],
  AAPL_ADDRESS: ["VITE_AAPL_ADDRESS"],
  MSFT_ADDRESS: ["VITE_MSFT_ADDRESS"],
  ISP_MI_ADDRESS: ["VITE_ISP_MI_ADDRESS"],
  EQUITY_AAPL_ADDRESS: ["VITE_AAPL_ADDRESS"],
  EQUITY_MSFT_ADDRESS: ["VITE_MSFT_ADDRESS"],
  EQUITY_ISP_MI_ADDRESS: ["VITE_ISP_MI_ADDRESS"],
};

function readEnvValue(key, envFile = ".env") {
  const p = path.join(process.cwd(), envFile);
  if (!fs.existsSync(p)) return "";
  const content = fs.readFileSync(p, "utf8");
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(re);
  return match ? String(match[1]).trim().replace(/^"(.*)"$/, "$1") : "";
}

function setEnvValue(key, value, envFile = ".env") {
  const p = path.join(process.cwd(), envFile);
  const line = `${key}=${value}`;
  let content = "";
  if (fs.existsSync(p)) content = fs.readFileSync(p, "utf8");

  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += line + "\n";
  }
  fs.writeFileSync(p, content);
}

function mirrorToDappEnv(key, value) {
  const targetEnvFile = dappEnvFile();
  const viteKeys = VITE_KEY_MAP[key] || [];
  for (const viteKey of viteKeys) {
    setEnvValue(viteKey, value, targetEnvFile);
  }
}

function envAddress(key, value, envFile = ".env") {
  const targetEnvFile = envFile === ".env" ? rootEnvFile() : envFile;
  if (typeof value === "undefined") {
    return readEnvValue(key, targetEnvFile);
  }

  setEnvValue(key, value, targetEnvFile);
  if (targetEnvFile === rootEnvFile()) mirrorToDappEnv(key, value);
  return value;
}

envAddress.read = readEnvValue;
envAddress.set = setEnvValue;

module.exports = envAddress;
