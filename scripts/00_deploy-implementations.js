const hre = require("hardhat");
const envAddress = require("./utils");
const { loadDeployments, saveDeployments } = require("./lib/deployments");

async function main() {
  const { ethers, network } = hre;
  const [admin] = await ethers.getSigners();
  const dep = loadDeployments(network.name);

  if (dep.fundImpl && dep.equityImpl && dep.stableImpl && dep.factory) {
    envAddress("FACTORY_ADDRESS", dep.factory);
    console.log("Implementations + Factory already deployed");
    console.log(dep);
    return;
  }

  const FundToken = await ethers.getContractFactory("FundToken", admin);
  const fundImpl = await FundToken.deploy();
  await fundImpl.waitForDeployment();

  const EquityToken = await ethers.getContractFactory("EquityToken", admin);
  const equityImpl = await EquityToken.deploy();
  await equityImpl.waitForDeployment();

  const StableToken = await ethers.getContractFactory("StableToken", admin);
  const stableImpl = await StableToken.deploy();
  await stableImpl.waitForDeployment();

  const Factory = await ethers.getContractFactory("SecurityTokenBeaconFactory", admin);
  const factory = await Factory.deploy(
    await fundImpl.getAddress(),
    await equityImpl.getAddress(),
    await stableImpl.getAddress(),
    admin.address
  );
  await factory.waitForDeployment();

  const out = saveDeployments(network.name, {
    fundImpl: await fundImpl.getAddress(),
    equityImpl: await equityImpl.getAddress(),
    stableImpl: await stableImpl.getAddress(),
    factory: await factory.getAddress(),
    factoryOwner: admin.address,
  });

  envAddress("FACTORY_ADDRESS", out.factory);

  console.log("Implementations + Factory deployed");
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
