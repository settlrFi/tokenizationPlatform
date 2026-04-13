// tasks/complianceOfficer.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getComplianceRegistry, signerFromEnv } from "./_helpers";

task("registry:onboard", "Whitelist + KYC expiry (COMPLIANCE_ROLE)")
  .addParam("investor")
  .addOptionalParam("days", "Validità KYC in giorni", "30")
  .setAction(async ({ investor, days }, hre: HardhatRuntimeEnvironment) => {
    const { reg, dep, ethers } = await getComplianceRegistry(hre);
    const signer = signerFromEnv(ethers, "COMPLIANCE_PK");
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + parseInt(days, 10) * 24 * 60 * 60;

    await (await reg.connect(signer).setWhitelist(investor, true)).wait();
    await (await reg.connect(signer).setKycExpiry(investor, expiry)).wait();

    console.log("✅ Onboarded", investor, "su", dep.address, "expiry:", expiry);
  });

task("registry:blacklist", "Imposta blacklist (COMPLIANCE_ROLE)")
  .addParam("investor")
  .addParam("banned", "true/false")
  .setAction(async ({ investor, banned }, hre: HardhatRuntimeEnvironment) => {
    const { reg, dep, ethers } = await getComplianceRegistry(hre);
    const signer = signerFromEnv(ethers, "COMPLIANCE_PK");
    const flag = String(banned).toLowerCase() === "true";
    await (await reg.connect(signer).setBlacklist(investor, flag)).wait();
    console.log("✅ blacklist", investor, "=", flag, "su", dep.address);
  });
