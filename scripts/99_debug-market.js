const hre = require("hardhat");
const { loadDeployments } = require("./lib/deployments");

async function main() {
  const { ethers, network } = hre;
  const dep = loadDeployments(network.name);

  const UI = process.env.UI_WALLET; // metti qui l’address metamask
  if (!UI) throw new Error("Set UI_WALLET=0x...");

  const [admin, complianceOfficer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("ComplianceRegistry", dep.complianceRegistry, complianceOfficer);

  const expiry = Math.floor(Date.now()/1000) + 3600*24*365*10;
  await (await registry.setWhitelist(UI, true)).wait();
  await (await registry.setKycExpiry(UI, expiry)).wait();

  console.log("✅ whitelisted UI:", UI);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
