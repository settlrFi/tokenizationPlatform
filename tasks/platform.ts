// tasks/platform.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getSecurityToken, signerFromEnv, parse18, toOrderId } from "./_helpers";

task("platform:propose-mint", "Richiesta sottoscrizione (PLATFORM_ROLE)")
  .addParam("investor")
  .addParam("amount", "Quote es. '990'")
  .addParam("order", "ID ordine es. ORDER#1 (o 0x...64)")
  .setAction(async ({ investor, amount, order }, hre: HardhatRuntimeEnvironment) => {
    const { st, dep, ethers } = await getSecurityToken(hre);
    const signer = signerFromEnv(ethers, "PLATFORM_PK");
    const amount18 = parse18(ethers, amount);
    const orderId = toOrderId(ethers, order);
    await (await st.connect(signer).proposeMint(investor, amount18, orderId)).wait();
    console.log("✅ ProposeMint registrata su", dep.address);
  });

task("platform:propose-burn", "Richiesta rimborso (PLATFORM_ROLE)")
  .addParam("investor")
  .addParam("amount", "Quote es. '300'")
  .addParam("order", "ID rimborso es. REDEEM#1 (o 0x...64)")
  .setAction(async ({ investor, amount, order }, hre: HardhatRuntimeEnvironment) => {
    const { st, dep, ethers } = await getSecurityToken(hre);
    const signer = signerFromEnv(ethers, "PLATFORM_PK");
    const shares18 = parse18(ethers, amount);
    const orderId = toOrderId(ethers, order);
    await (await st.connect(signer).proposeBurn(investor, shares18, orderId)).wait();
    console.log("✅ ProposeBurn registrata su", dep.address);
  });
