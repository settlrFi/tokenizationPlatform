import { expect } from "chai";
import { ethers } from "hardhat";

describe("SecurityToken + ComplianceRegistry", function () {
  it("blocca i trasferimenti se il destinatario non è whitelisted/KYC", async () => {
    const [admin, officer, alice, bob] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("ComplianceRegistry");
    const registry = await Registry.deploy(admin.address, officer.address);
    await registry.waitForDeployment();

    const Token = await ethers.getContractFactory("SecurityToken");
    const token = await Token.deploy("RWA Fund Share", "RWA", admin.address, officer.address, await registry.getAddress());
    await token.waitForDeployment();

    // KYC + whitelist admin per ricevere il mint
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await registry.connect(officer).setWhitelisted(admin.address, true);
    await registry.connect(officer).setKyc(admin.address, now + 365 * 24 * 60 * 60);
    await token.mint(admin.address, ethers.parseUnits("100", 18));

    // whitelista + KYC alice (destinataria valida)
    await registry.connect(officer).setWhitelisted(alice.address, true);
    await registry.connect(officer).setKyc(alice.address, now + 1000);

    // bob non whitelisted/KYC
    // trasferimento verso alice: OK
    await expect(token.transfer(alice.address, ethers.parseUnits("10", 18))).to.emit(token, "Transfer");

    // alice -> bob: deve fallire
    await expect(
      token.connect(alice).transfer(bob.address, ethers.parseUnits("1", 18))
    ).to.be.revertedWith("Compliance: transfer blocked");

    // blacklista alice: ora anche transfer verso alice fallisce
    await registry.connect(officer).setBlacklisted(alice.address, true);
    await expect(
      token.transfer(alice.address, ethers.parseUnits("1", 18))
    ).to.be.revertedWith("Compliance: transfer blocked");
  });
});
