import { ethers } from "hardhat";

const MARKET_ABI = [
  "function INVENTORY_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

async function main() {
  const marketAddress = process.env.MARKET_ADDRESS;
  const maker = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

  const [admin, compliance] = await ethers.getSigners();
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

  await reg.connect(compliance).setWhitelist(market, true);
  await reg.connect(compliance).setKycExpiry(market, kyc);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
