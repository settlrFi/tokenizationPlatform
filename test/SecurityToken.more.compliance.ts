import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";

const parse = (v: string, d = 18) => ethers.parseUnits(v, d);
const ZERO = ethers.ZeroAddress;

async function setup() {
  await deployments.fixture();

  const [admin, officer, alice, bob, carol] = await ethers.getSigners();
  const regDep = await deployments.get("ComplianceRegistry");
  const tokDep = await deployments.get("SecurityToken");

  const registry = await ethers.getContractAt("ComplianceRegistry", regDep.address);
  const token    = await ethers.getContractAt("SecurityToken", tokDep.address);

  const nowBlk = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  const now    = nowBlk!.timestamp;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  return { admin, officer, alice, bob, carol, registry, token, now, ONE_YEAR };
}

async function makeCompliant(registry: any, officer: any, addr: string, expiry: number) {
  await (await registry.connect(officer).setWhitelisted(addr, true)).wait();
  await (await registry.connect(officer).setKyc(addr, expiry)).wait();
}

describe("SecurityToken - suite estesa di compliance/ruoli/flow", () => {
  it("mint verso address non compliant deve revertare; verso compliant emette Transfer(0x0, to, amount)", async () => {
    const { admin, officer, alice, bob, registry, token, now, ONE_YEAR } = await setup();

    // admin compliant per poter MINTARE a sé stesso
    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);

    // bob NON compliant: mint a bob deve fallire
    await expect(
      token.connect(admin).mint(bob.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");

    // rendi alice compliant e mint ok con evento Transfer
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);
    const tx = await token.connect(admin).mint(alice.address, parse("2"));
    await expect(tx).to.emit(token, "Transfer").withArgs(ZERO, alice.address, parse("2"));

    expect(await token.balanceOf(alice.address)).to.eq(parse("2"));
  });

  it("solo OFFICER può settare whitelist/KYC/blacklist (gli altri devono revertare)", async () => {
    const { admin, alice, registry, now, ONE_YEAR } = await setup();

    await expect(registry.connect(admin).setWhitelisted(alice.address, true)).to.be.reverted;
    await expect(registry.connect(admin).setKyc(alice.address, now + ONE_YEAR)).to.be.reverted;
    await expect(registry.connect(admin).setBlacklisted(alice.address, true)).to.be.reverted;
  });

  it("solo MINTER può mintare", async () => {
    const { officer, alice, registry, token, now, ONE_YEAR } = await setup();
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);

    // officer presumibilmente NON ha MINTER_ROLE
    await expect(token.connect(officer).mint(alice.address, parse("1"))).to.be.reverted;
  });

  it("blacklist su SENDER blocca le uscite; blacklist su RECIPIENT blocca le entrate", async () => {
    const { admin, officer, alice, bob, registry, token, now, ONE_YEAR } = await setup();

    // admin/alice/bob compliant
    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, bob.address,   now + ONE_YEAR);

    // mint e seed
    await (await token.connect(admin).mint(alice.address, parse("10"))).wait();
    expect(await token.balanceOf(alice.address)).to.eq(parse("10"));

    // blacklist RECIPIENT (bob) → blocca ingresso
    await (await registry.connect(officer).setBlacklisted(bob.address, true)).wait();
    await expect(
      token.connect(alice).transfer(bob.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");

    // togli blacklist a bob, ma mettila su SENDER (alice) → blocca uscita
    await (await registry.connect(officer).setBlacklisted(bob.address, false)).wait();
    await (await registry.connect(officer).setBlacklisted(alice.address, true)).wait();
    await expect(
      token.connect(alice).transfer(bob.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });

  it("togglare whitelist a false blocca i transfer anche se KYC è valido", async () => {
    const { admin, officer, alice, registry, token, now, ONE_YEAR } = await setup();

    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);

    await (await token.connect(admin).mint(alice.address, parse("5"))).wait();
    await (await token.connect(alice).transfer(admin.address, parse("1"))).wait(); // ok finché whitelisted

    // rimuovi whitelist ad alice
    await (await registry.connect(officer).setWhitelisted(alice.address, false)).wait();

    await expect(
      token.connect(alice).transfer(admin.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });

  it("approve/transferFrom: funziona verso compliant, revert verso non compliant", async () => {
    const { admin, officer, alice, bob, carol, registry, token, now, ONE_YEAR } = await setup();

    // admin/alice/carol compliant; bob non compliant
    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, carol.address, now + ONE_YEAR);

    await (await token.connect(admin).mint(alice.address, parse("10"))).wait();

    // alice approva carol a spendere 3
    await (await token.connect(alice).approve(carol.address, parse("3"))).wait();
    expect(await token.allowance(alice.address, carol.address)).to.eq(parse("3"));

    // transferFrom (carol) → verso admin (compliant) OK
    await (await token.connect(carol).transferFrom(alice.address, admin.address, parse("2"))).wait();
    expect(await token.balanceOf(admin.address)).to.eq(parse("2"));

    // transferFrom verso bob (non compliant) → revert
    await expect(
      token.connect(carol).transferFrom(alice.address, bob.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });

  it("scadenza KYC del recipient blocca il ricevere dopo l'expiry", async () => {
    const { admin, officer, alice, registry, token, now } = await setup();

    // admin whitelist+KYC lungo, alice whitelist+KYC breve
    await (await registry.connect(officer).setWhitelisted(admin.address, true)).wait();
    await (await registry.connect(officer).setKyc(admin.address, now + 3600)).wait();

    await (await registry.connect(officer).setWhitelisted(alice.address, true)).wait();
    await (await registry.connect(officer).setKyc(alice.address, now + 5)).wait();

    // prima della scadenza → OK
    await (await token.connect(admin).mint(admin.address, parse("5"))).wait();
    await (await token.connect(admin).transfer(alice.address, parse("1"))).wait();

    // avanza oltre scadenza di alice
    await network.provider.send("evm_setNextBlockTimestamp", [now + 10]);
    await network.provider.send("evm_mine");

    // ora alice NON dovrebbe più poter ricevere
    await expect(
      token.connect(admin).transfer(alice.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });

  it("scadenza KYC del sender blocca il trasferire dopo l'expiry", async () => {
    const { admin, officer, alice, registry, token, now } = await setup();

    await (await registry.connect(officer).setWhitelisted(admin.address, true)).wait();
    await (await registry.connect(officer).setKyc(admin.address, now + 5)).wait();

    await (await registry.connect(officer).setWhitelisted(alice.address, true)).wait();
    await (await registry.connect(officer).setKyc(alice.address, now + 3600)).wait();

    await (await token.connect(admin).mint(admin.address, parse("3"))).wait();

    // prima della scadenza → OK
    await (await token.connect(admin).transfer(alice.address, parse("1"))).wait();

    // avanza oltre scadenza di admin (sender)
    await network.provider.send("evm_setNextBlockTimestamp", [now + 10]);
    await network.provider.send("evm_mine");

    await expect(
      token.connect(admin).transfer(alice.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });

  it("revocare blacklist e rimettere whitelist ripristina la trasferibilità", async () => {
    const { admin, officer, alice, registry, token, now, ONE_YEAR } = await setup();

    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);

    await (await token.connect(admin).mint(admin.address, parse("5"))).wait();

    // blacklist recipient → blocco
    await (await registry.connect(officer).setBlacklisted(alice.address, true)).wait();
    await expect(
      token.connect(admin).transfer(alice.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");

    // rimuovi blacklist → torna trasferibile
    await (await registry.connect(officer).setBlacklisted(alice.address, false)).wait();
    await (await token.connect(admin).transfer(alice.address, parse("1"))).wait();
    expect(await token.balanceOf(alice.address)).to.eq(parse("1"));

    // rimuovi whitelist → blocco
    await (await registry.connect(officer).setWhitelisted(alice.address, false)).wait();
    await expect(
      token.connect(admin).transfer(alice.address, parse("1"))
    ).to.be.revertedWith("Compliance: transfer blocked");

    // rimetti whitelist → ok
    await (await registry.connect(officer).setWhitelisted(alice.address, true)).wait();
    await (await token.connect(admin).transfer(alice.address, parse("1"))).wait();
    expect(await token.balanceOf(alice.address)).to.eq(parse("2"));
  });

  it("Transfer event emesso correttamente anche su transferFrom valido", async () => {
    const { admin, officer, alice, registry, token, now, ONE_YEAR } = await setup();

    await makeCompliant(registry, officer, admin.address, now + ONE_YEAR);
    await makeCompliant(registry, officer, alice.address, now + ONE_YEAR);

    await (await token.connect(admin).mint(alice.address, parse("7"))).wait();
    await (await token.connect(alice).approve(admin.address, parse("3"))).wait();

    const tx = await token.connect(admin).transferFrom(alice.address, admin.address, parse("3"));
    await expect(tx).to.emit(token, "Transfer").withArgs(alice.address, admin.address, parse("3"));
  });
});
