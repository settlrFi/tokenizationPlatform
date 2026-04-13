import { ethers } from "hardhat";
import envAddress from "./utils";

async function main() {
  const [deployer, , depositary] = await ethers.getSigners();

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

  const stableAddress = process.env.STABLE_ADDRESS;
  if (!stableAddress) throw new Error("Missing STABLE_ADDRESS in env");
  const token = await ethers.getContractAt("StableToken", stableAddress);
  const tokenAddr = await token.getAddress();
  envAddress("TOKEN", tokenAddr);
  console.log("Stable token (TOKEN):", tokenAddr);

  const userAddr = process.env.OWNER ?? deployer.address;

  const decimals = BigInt(await token.decimals());
  const initialUser = 1_000_000n * 10n ** decimals; // 1,000,000 mUSD
  const initialRelayer = 100_000n * 10n ** decimals;

  const mintLike = token.interface.getFunction("mint(address,uint256)");
  const authorizeMintLike = token.interface.getFunction("authorizeMint(address,uint256,bytes32)");

  if (mintLike) {
    const tx1 = await (token as any).mint(userAddr, initialUser);
    await tx1.wait();
    console.log(`Minted to OWNER (${userAddr}):`, initialUser.toString());

    const tx2 = await (token as any).mint(deployer.address, initialRelayer);
    await tx2.wait();
    console.log(`Minted to RELAYER (${deployer.address}):`, initialRelayer.toString());
    return;
  }

  if (!authorizeMintLike) {
    console.log("Token bootstrap skipped: no mint/authorizeMint function exposed.");
    return;
  }

  if (!depositary) {
    throw new Error("Missing depositary signer required for authorizeMint bootstrap");
  }

  const depositaryToken = token.connect(depositary);
  const ownerOrderId = ethers.id(`proxy-wallet-owner-${userAddr}`);
  const relayerOrderId = ethers.id(`proxy-wallet-relayer-${deployer.address}`);

  const tx1 = await (depositaryToken as any).authorizeMint(userAddr, initialUser, ownerOrderId);
  await tx1.wait();
  console.log(`Authorized mint to OWNER (${userAddr}):`, initialUser.toString());

  const tx2 = await (depositaryToken as any).authorizeMint(deployer.address, initialRelayer, relayerOrderId);
  await tx2.wait();
  console.log(`Authorized mint to RELAYER (${deployer.address}):`, initialRelayer.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
