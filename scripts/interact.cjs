// CommonJS + compat v5/v6
const hre = require("hardhat");
const { ethers, deployments } = hre;

// compat helpers (v5/v6)
const parseUnits  = ethers.parseUnits  ?? ((v,d) => ethers.utils.parseUnits(v,d));
const formatUnits = ethers.formatUnits ?? ((v,d) => ethers.utils.formatUnits(v,d));

const ONE_YEAR = 365 * 24 * 60 * 60;

async function main() {
  const [admin, officer, alice, bob] = await ethers.getSigners();

  // richiede hardhat-deploy: verifica di avere `require("hardhat-deploy");` nel config
  const regDep = await deployments.get("ComplianceRegistry");
  const tokDep = await deployments.get("SecurityToken");

  const registry = await ethers.getContractAt("ComplianceRegistry", regDep.address);
  const token    = await ethers.getContractAt("SecurityToken",    tokDep.address);

  const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;

  console.log("Registry:", regDep.address);
  console.log("Token   :", tokDep.address);

  // --- Setup compliance ---
  console.log("Imposto compliance per ADMIN (necessaria per mint verso admin)...");
  await (await registry.connect(officer).setWhitelisted(admin.address, true)).wait();
  await (await registry.connect(officer).setKyc(admin.address, now + ONE_YEAR)).wait();

  console.log("Imposto compliance per ALICE (necessaria per ricevere e trasferire)...");
  await (await registry.connect(officer).setWhitelisted(alice.address, true)).wait();
  await (await registry.connect(officer).setKyc(alice.address, now + ONE_YEAR)).wait();

  // --- Mint & transfer ---
  console.log("Mint 100 STK ad ADMIN (admin ha MINTER_ROLE)...");
  await (await token.connect(admin).mint(admin.address, parseUnits("100", 18))).wait();

  console.log("Trasferisci 5 STK da ADMIN a ALICE...");
  await (await token.connect(admin).transfer(alice.address, parseUnits("5", 18))).wait();

  const balAlice = await token.balanceOf(alice.address);
  console.log("Saldo ALICE:", formatUnits(balAlice, 18));

  // --- Tentativo di trasferimento verso BOB (non compliant) ---
  console.log("Provo transfer ALICE -> BOB (BOB non compliant: atteso REVERT)...");
  try {
    await (await token.connect(alice).transfer(bob.address, parseUnits("1", 18))).wait();
    console.log("⚠️ Transfer è riuscito: allora BOB risulta compliant (controlla registry!)");
  } catch (err) {
    console.log("✅ Revert atteso:", err?.message ?? err);
  }

  // --- Blacklist ALICE e prova un transfer in ingresso ---
  console.log("Blacklist ALICE e prova a trasferirle 1 STK...");
  await (await registry.connect(officer).setBlacklisted(alice.address, true)).wait();
  try {
    await (await token.connect(admin).transfer(alice.address, parseUnits("1", 18))).wait();
    console.log("⚠️ Transfer è riuscito: verifica la logica registry.isTransferAllowed");
  } catch (err) {
    console.log("✅ Revert (Compliance: transfer blocked):", err?.message ?? err);
  }

  console.log("Done ✅");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
