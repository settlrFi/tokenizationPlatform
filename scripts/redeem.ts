import { deployments, ethers } from "hardhat";

async function main() {
  const [,, , investor] = await ethers.getSigners();
  const vaultDep = await deployments.get("FundVault4626");
  const vault    = await ethers.getContractAt("FundVault4626", vaultDep.address);

  const shares = await vault.balanceOf(investor.address);
  const tx = await vault.connect(investor).redeem(shares, investor.address, investor.address);
  await tx.wait();

  console.log("Redeemed", shares.toString(), "shares");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
