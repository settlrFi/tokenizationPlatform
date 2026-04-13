import { deployments, ethers } from "hardhat";

const parse6 = (v: string) => ethers.parseUnits(v, 6);

async function main() {
  const [deployer, admin, officer, navSetter] = await ethers.getSigners();
  const vaultDep = await deployments.get("FundVault4626");
  const vault = await ethers.getContractAt("FundVault4626", vaultDep.address);

  await (await vault.connect(navSetter).setVirtualAssetBuffer(parse6("10"))).wait();
  console.log("Applied NAV buffer: +10 USDCt virtual");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
