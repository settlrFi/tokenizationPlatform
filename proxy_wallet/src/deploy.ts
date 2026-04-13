import { ethers } from "hardhat";
import envAddress from "./utils";

async function main() {
  const [deployer] = await ethers.getSigners();

  envAddress("RELAYER_ADDR",deployer.address);
  console.log("Deployer:", deployer.address);

  // 1) Deploy implementation (ProxyWallet)
  const ProxyWallet = await ethers.getContractFactory("ProxyWallet");
  const impl = await ProxyWallet.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  
  console.log("ProxyWallet impl:", implAddr);

  // 2) Deploy factory
  const Factory = await ethers.getContractFactory("ProxyWalletFactory");
  const factory = await Factory.deploy(implAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  envAddress("FACTORY", factoryAddr);
  console.log("Factory:", factoryAddr);


  const Bundler = await ethers.getContractFactory("RelayBundler");
  const bundler = await Bundler.deploy();
  await bundler.waitForDeployment();
  const bundlerAddr = await bundler.getAddress();

  envAddress("BUNDLER", bundlerAddr);
  console.log("RelayBundler:", bundlerAddr);


  const Token = await ethers.getContractFactory("StableToken");
  //const token = await Token.deploy("Mock USD", "mUSD");
  //await token.waitForDeployment();
  const token = await Token.attach(process.env.STABLE_ADDRESS);
  const tokenAddr = await token.getAddress();
  envAddress("TOKEN", tokenAddr);
  console.log("MockERC20Permit (TOKEN):", tokenAddr);

  const userAddr = process.env.OWNER ?? deployer.address;

  const decimals = 18n;
  const initialUser = 1_000_000n * 10n ** decimals; // 1,000,000 mUSD
  const initialRelayer = 100_000n * 10n ** decimals;

  const tx1 = await token.mint(userAddr, initialUser);
  await tx1.wait();
  console.log(`Minted to OWNER (${userAddr}):`, initialUser.toString());

  const tx2 = await token.mint(deployer.address, initialRelayer);
  await tx2.wait();
  console.log(`Minted to RELAYER (${deployer.address}):`, initialRelayer.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
