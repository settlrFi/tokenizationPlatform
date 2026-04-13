import { deployments, ethers } from "hardhat";

async function main() {
  const [admin, officer, investor] = await ethers.getSigners();
  const regDep = await deployments.get("ComplianceRegistry");
  const registry = await ethers.getContractAt("ComplianceRegistry", regDep.address);

  const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))!.timestamp;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  await (await registry.connect(officer).setWhitelisted(investor.address, true)).wait();
  await (await registry.connect(officer).setKyc(investor.address, now + ONE_YEAR)).wait();

  console.log("Onboarded:", investor.address);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
