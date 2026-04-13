// tasks/common.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getNavOracle, getSecurityToken, getComplianceRegistry } from "./_helpers";

task("nav:current", "Mostra NAV corrente dal NavOracle").setAction(
  async (_, hre: HardhatRuntimeEnvironment) => {
    const { nav, dep } = await getNavOracle(hre);
    const [navValue, updatedAt, adjBps] = await nav.currentNav();
    console.log("NavOracle @", dep.address);
    console.log("NAV       :", navValue.toString());
    console.log("updatedAt :", updatedAt.toString());
    console.log("adjBps    :", adjBps.toString());
  }
);

task("token:nav", "Mostra NAV visto dal SecurityToken").setAction(
  async (_, hre: HardhatRuntimeEnvironment) => {
    const { st, dep } = await getSecurityToken(hre);
    const [navValue, updatedAt, adjBps] = await st.currentNav();
    console.log("SecurityToken @", dep.address);
    console.log("nav       :", navValue.toString());
    console.log("updatedAt :", updatedAt.toString());
    console.log("adjBps    :", adjBps.toString());
  }
);

task("registry:status", "Stato compliance (whitelist/blacklist/kycExpiry)")
  .addParam("investor", "Address")
  .setAction(async ({ investor }, hre: HardhatRuntimeEnvironment) => {
    const { reg, dep } = await getComplianceRegistry(hre);
    const whitelisted = await reg.isWhitelisted(investor);
    const blacklisted = await reg.isBlacklisted(investor);
    const expiry = await reg.kycexpiry(investor);
    console.log("ComplianceRegistry @", dep.address);
    console.log("investor   :", investor);
    console.log("whitelisted:", whitelisted);
    console.log("blacklisted:", blacklisted);
    console.log("kycExpiry  :", expiry.toString());
  });
