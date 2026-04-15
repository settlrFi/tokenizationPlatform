import hre, { ethers } from "hardhat";
import envAddress from "./utils";

const { loadDeployments, saveDeployments } = require("../../scripts/lib/deployments");

async function main() {
  const [deployer, , depositarySigner] = await ethers.getSigners();
  const depositary = depositarySigner ?? deployer;
  const dep = loadDeployments(hre.network.name);

  envAddress("RELAYER_ADDR",deployer.address);
  console.log("Deployer:", deployer.address);

  // 1) Deploy implementation (ProxyWallet)
  let implAddr = dep.proxyWalletImpl;
  if (!implAddr) {
    const ProxyWallet = await ethers.getContractFactory("ProxyWallet");
    const impl = await ProxyWallet.deploy();
    await impl.waitForDeployment();
    implAddr = await impl.getAddress();
    saveDeployments(hre.network.name, { proxyWalletImpl: implAddr });
  }
  
  console.log("ProxyWallet impl:", implAddr);

  // 2) Deploy factory
  let factoryAddr = dep.proxyWalletFactory;
  if (!factoryAddr) {
    const Factory = await ethers.getContractFactory("ProxyWalletFactory");
    const factory = await Factory.deploy(implAddr);
    await factory.waitForDeployment();
    factoryAddr = await factory.getAddress();
    saveDeployments(hre.network.name, { proxyWalletFactory: factoryAddr });
  }

  envAddress("FACTORY", factoryAddr);
  console.log("Factory:", factoryAddr);


  let bundlerAddr = dep.relayBundler;
  if (!bundlerAddr) {
    const Bundler = await ethers.getContractFactory("RelayBundler");
    const bundler = await Bundler.deploy();
    await bundler.waitForDeployment();
    bundlerAddr = await bundler.getAddress();
    saveDeployments(hre.network.name, { relayBundler: bundlerAddr });
  }

  envAddress("BUNDLER", bundlerAddr);
  console.log("RelayBundler:", bundlerAddr);

  const stableAddress = process.env.STABLE_ADDRESS;
  if (!stableAddress) throw new Error("Missing STABLE_ADDRESS in env");
  const token = await ethers.getContractAt("StableToken", stableAddress);
  const tokenAddr = await token.getAddress();
  envAddress("TOKEN", tokenAddr);
  console.log("Stable token (TOKEN):", tokenAddr);

  if (dep.proxyWalletBootstrapDone) {
    console.log("Proxy wallet bootstrap already completed");
    return;
  }

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
    saveDeployments(hre.network.name, { proxyWalletBootstrapDone: true });
    return;
  }

  if (!authorizeMintLike) {
    console.log("Token bootstrap skipped: no mint/authorizeMint function exposed.");
    saveDeployments(hre.network.name, { proxyWalletBootstrapDone: true });
    return;
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
  saveDeployments(hre.network.name, { proxyWalletBootstrapDone: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
