import "dotenv/config";
import { ethers } from "hardhat";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const tokenAddr = mustEnv("TOKEN");
  const ownerAddr = mustEnv("OWNER");
  const amountHuman = process.env.AMOUNT_TOKEN_TO_OWNER ?? "1000"; // default 1000 token

  const [deployer] = await ethers.getSigners();

  const token = await ethers.getContractAt(
    [
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)"
    ],
    tokenAddr,
    deployer
  );

  const decimals: number = await token.decimals();
  const amount = ethers.parseUnits(amountHuman, decimals);

  const beforeDeployer: bigint = await token.balanceOf(deployer.address);
  const beforeOwner: bigint = await token.balanceOf(ownerAddr);

  console.log("TOKEN:", tokenAddr);
  console.log("Deployer:", deployer.address);
  console.log("Owner:", ownerAddr);
  console.log("Decimals:", decimals);
  console.log("Transfer amount (human):", amountHuman);
  console.log("Transfer amount (raw):", amount.toString());
  console.log("Balances before:");
  console.log("  deployer:", beforeDeployer.toString());
  console.log("  owner   :", beforeOwner.toString());

  const tx = await token.transfer(ownerAddr, amount);
  console.log("tx:", tx.hash);
  await tx.wait();

  const afterDeployer: bigint = await token.balanceOf(deployer.address);
  const afterOwner: bigint = await token.balanceOf(ownerAddr);

  console.log("Balances after:");
  console.log("  deployer:", afterDeployer.toString());
  console.log("  owner   :", afterOwner.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
