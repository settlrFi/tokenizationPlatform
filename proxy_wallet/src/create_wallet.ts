import { ethers } from "hardhat";
import envAddress from "./utils";

const FACTORY = process.env.FACTORY!;
const OWNER = process.env.OWNER!;

async function main() {
  const factory = await ethers.getContractAt("ProxyWalletFactory", FACTORY);

  const predicted = await factory.predictWallet(OWNER);
  console.log("Predicted wallet:", predicted);
  envAddress("PROXY_WALLET", predicted);

  const tx = await factory.getOrCreateWallet(OWNER);
  console.log("tx:", tx.hash);
  await tx.wait();

  const code = await ethers.provider.getCode(predicted);
  console.log("Deployed:", code !== "0x");
}

main().catch(console.error);
