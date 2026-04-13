const { getSigners, getContractFactory } = require("ethers");
const envAddress = require("./utils");
const { ethers } = require("hardhat");

async function main() {
    const [admin, complianceOfficer, depositary, platform] = await ethers.getSigners();

    const Reg = await ethers.getContractFactory("ComplianceRegistry");
    const reg = await Reg.connect(admin).deploy(admin.address, complianceOfficer.address);

    const StDeploy = await ethers.getContractFactory("SecurityToken");
    //console.log(admin.address, complianceOfficer.address, await reg.getAddress());
    const stDeploy = await StDeploy.connect(admin).deploy( "Fondo DLT", "FDLT", admin.address, complianceOfficer.address, await reg.getAddress());

    const tokenAddress = await stDeploy.getAddress();
    
    console.log(tokenAddress);
    envAddress("STABLE_ADDRESS", tokenAddress);
    envAddress("COMPLIANCE_REGISTRY", await reg.getAddress());

    // Assegno i ruoli
    const DEPOSITARY_ROLE = await stDeploy.DEPOSITARY_ROLE();
    const PLATFORM_ROLE   = await stDeploy.PLATFORM_ROLE();
    const PAUSER_ROLE     = await stDeploy.PAUSER_ROLE();
    const COMPLIANCE_ROLE = await stDeploy.COMPLIANCE_ROLE();
    const REGISTRY_ROLE   = await stDeploy.REGISTRY_ROLE();

    await (await stDeploy.connect(admin).grantRole(DEPOSITARY_ROLE, depositary)).wait();
    await (await stDeploy.connect(admin).grantRole(PLATFORM_ROLE, platform)).wait();
    await (await stDeploy.connect(admin).grantRole(PAUSER_ROLE, admin)).wait();
    await (await stDeploy.connect(admin).grantRole(REGISTRY_ROLE, admin)).wait();



}


main().catch((e) => { console.error(e); process.exit(1); });