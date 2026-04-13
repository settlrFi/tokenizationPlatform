import { ethers } from "hardhat";

async function main() {
  const [deployer, complianceOfficer] = await ethers.getSigners();

  // 1) Deploy ComplianceRegistry
  const Registry = await ethers.getContractFactory("ComplianceRegistry");
  const registry = await Registry.deploy(deployer.address, complianceOfficer.address);
  await registry.waitForDeployment();
  console.log("ComplianceRegistry:", await registry.getAddress());

  // 2) Deploy SecurityToken
  const Token = await ethers.getContractFactory("SecurityToken");
  const token = await Token.deploy(
    "RWA Fund Share",
    "RWA",
    deployer.address,
    complianceOfficer.address,
    await registry.getAddress()
  );
  await token.waitForDeployment();
  console.log("SecurityToken:", await token.getAddress());

  // 3) Setup di esempio: whitelista e KYC il deployer per ricevere mint
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const setWL = await registry.connect(complianceOfficer).setWhitelisted(deployer.address, true);
  await setWL.wait();
  const setKyc = await registry.connect(complianceOfficer).setKyc(deployer.address, now + oneYear);
  await setKyc.wait();

  // 4) Mint iniziale
  const mintTx = await token.mint(deployer.address, ethers.parseUnits("1000", 18));
  await mintTx.wait();
  console.log("Minted 1000 RWA to deployer");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
