import { ethers, network } from "hardhat";
import { getAddress } from "ethers";
const { saveDeployments } = require("./lib/deployments");

const MARKET_ABI = [
  "function INVENTORY_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  const marketAddress = process.env.MARKET_ADDRESS;
  if (!marketAddress) throw new Error("Missing MARKET_ADDRESS");

  const signers = await ethers.getSigners();
  if (!signers.length) throw new Error("No signer available");

  const admin = signers[0];
  const compliance = signers[1] ?? admin;
  const maker = getAddress(process.env.MAKER_ADDRESS ?? "0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  const market = new ethers.Contract(marketAddress, MARKET_ABI, admin);

  const role = await market.INVENTORY_ROLE();
  const already = await market.hasRole(role, maker);
  if (!already) {
    const tx = await market.grantRole(role, maker);
    await tx.wait();
    console.log("INVENTORY_ROLE granted:", maker);
  } else {
    console.log("INVENTORY_ROLE already set:", maker);
  }

  const reg = await ethers.getContractAt("ComplianceRegistry", process.env.COMPLIANCE_REGISTRY);
  
  const kyc = Math.floor(Date.now()/1000) + 36500*24*60*60;

  await reg.connect(compliance).setWhitelist(maker, true);
  await reg.connect(compliance).setKycExpiry(maker, kyc);

  await reg.connect(compliance).setWhitelist(marketAddress, true);
  await reg.connect(compliance).setKycExpiry(marketAddress, kyc);

  saveDeployments(network.name, { inventoryBootstrapDone: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
