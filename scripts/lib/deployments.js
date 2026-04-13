const fs = require("fs");
const path = require("path");

function deploymentsPath(networkName) {
  return path.join(process.cwd(), `deployments.${networkName}.json`);
}

function addressesDir() {
  return path.join(process.cwd(), "deployments");
}

function addressesPath(networkName) {
  return path.join(addressesDir(), `${networkName}.addresses.json`);
}

function loadDeployments(networkName) {
  const p = deploymentsPath(networkName);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function extractAddresses(data) {
  const out = {};

  const visit = (prefix, value) => {
    if (!value) return;

    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      out[prefix] = value;
      return;
    }

    if (Array.isArray(value)) return;
    if (typeof value !== "object") return;

    for (const [key, nested] of Object.entries(value)) {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      visit(nextKey, nested);
    }
  };

  visit("", data);
  return out;
}

function saveAddresses(networkName, data) {
  const dir = addressesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const payload = {
    network: networkName,
    updatedAt: new Date().toISOString(),
    addresses: extractAddresses(data),
  };

  fs.writeFileSync(addressesPath(networkName), JSON.stringify(payload, null, 2));
  return payload;
}

function saveDeployments(networkName, patch) {
  const current = loadDeployments(networkName);
  const next = { ...current, ...patch };
  fs.writeFileSync(deploymentsPath(networkName), JSON.stringify(next, null, 2));
  saveAddresses(networkName, next);
  return next;
}

module.exports = { loadDeployments, saveDeployments, saveAddresses };
