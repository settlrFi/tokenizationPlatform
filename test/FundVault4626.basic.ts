import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";

const parse6 = (v: string) => ethers.parseUnits(v, 6);

describe("FundVault4626", () => {
  it("deposit/redeem gated da compliance + NAV buffer", async () => {
    await deployments.fixture();

    const [admin, officer, navSetter, alice] = await ethers.getSigners();
    const usdcDep  = await deployments.get("USDCTest");
    const regDep   = await deployments.get("ComplianceRegistry");
    const vaultDep = await deployments.get("FundVault4626");

    const usdc  = await ethers.getContractAt("USDCTest", usdcDep.address);
    const reg   = await ethers.getContractAt("ComplianceRegistry", regDep.address);
    const vault = await ethers.getContractAt("FundVault4626", vaultDep.address);

    // whitelist + KYC
    const now = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber()))!.timestamp;
    await (await reg.connect(officer).setWhitelisted(alice.address, true)).wait();
    await (await reg.connect(officer).setKyc(alice.address, now + 3600)).wait();

    // fondi e approva
    await (await usdc.transfer(alice.address, parse6("1000"))).wait();
    await (await usdc.connect(alice).approve(vault.target as string, parse6("100"))).wait();

    // deposit
    const shares = await vault.connect(alice).deposit.staticCall(parse6("100"), alice.address);
    await (await vault.connect(alice).deposit(parse6("100"), alice.address)).wait();
    expect(await vault.balanceOf(alice.address)).to.eq(shares);

    // applica NAV buffer
    await (await vault.connect(navSetter).setVirtualAssetBuffer(parse6("10"))).wait();
    const preview = await vault.previewRedeem(shares);
    expect(preview).to.be.gt(parse6("100")); // NAV aumentato

    // redeem
    await (await vault.connect(alice).redeem(shares, alice.address, alice.address)).wait();
    const bal = await ethers.getContractAt("USDCTest", usdcDep.address).then(t => t.balanceOf(alice.address));
    expect(bal).to.be.gt(parse6("1000")); // ha guadagnato
  });
});
