const fs = require("fs");
const path = require("path");

function deploymentsPath(networkName) {
  return path.join(process.cwd(), `deployments.${networkName}.json`);
}

function loadDeployments(networkName) {
  const p = deploymentsPath(networkName);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveDeployments(networkName, patch) {
  const current = loadDeployments(networkName);
  const next = { ...current, ...patch };
  fs.writeFileSync(deploymentsPath(networkName), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { loadDeployments, saveDeployments };
