import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";

const parse = (v: string, d = 18) => ethers.parseUnits(v, d);

it("scadenza KYC: dopo la scadenza i transfer vengono bloccati", async () => {
  await deployments.fixture();

  const [admin, officer, alice] = await ethers.getSigners();
  const regDep = await deployments.get("ComplianceRegistry");
  const tokDep = await deployments.get("SecurityToken");

  const registry = await ethers.getContractAt("ComplianceRegistry", regDep.address);
  const token    = await ethers.getContractAt("SecurityToken", tokDep.address);

  //Tempo di riferimento
  const block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  const now   = block!.timestamp;

  // 1) Più margine
  const ONE_HOUR = 3600;

  // Whitelist
  await (await registry.connect(officer).setWhitelisted(admin.address, true)).wait();
  await (await registry.connect(officer).setWhitelisted(alice.address, true)).wait();

  // KYC valido per un'ora (solo l'officer può farlo, wait è per assicurarsi che la tx sia minata prima di proseguire)
  await (await registry.connect(officer).setKyc(admin.address, now + ONE_HOUR)).wait();
  await (await registry.connect(officer).setKyc(alice.address, now + ONE_HOUR)).wait();

  // 2) Operazioni prima della scadenza -> OK
  await (await token.connect(admin).mint(admin.address, parse("10"))).wait();
  await (await token.connect(admin).transfer(alice.address, parse("1"))).wait();

  // 3) Avanza oltre la scadenza (helper deterministico)
  //    usa evm_setNextBlockTimestamp oppure increaseTime+mine
  await network.provider.send("evm_setNextBlockTimestamp", [now + ONE_HOUR + 5]);
  await network.provider.send("evm_mine");

  // 4) Ora deve revertare
  await expect(
    token.connect(alice).transfer(admin.address, parse("1"))
  ).to.be.revertedWith("Compliance: transfer blocked");
});
