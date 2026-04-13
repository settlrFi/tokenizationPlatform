// tasks/depositary.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getSecurityToken, signerFromEnv, parse18, toOrderId } from "./_helpers";

task("depositary:authorize-mint", "Finalizza sottoscrizione (DEPOSITARY_ROLE)")
  .addParam("investor")
  .addParam("amount", "Quote es. '990'")
  .addParam("order", "ID ordine usato dalla platform (o 0x...64)")
  .setAction(async ({ investor, amount, order }, hre: HardhatRuntimeEnvironment) => {
    const { st, dep, ethers } = await getSecurityToken(hre);
    const signer = signerFromEnv(ethers, "DEPOSITARY_PK");
    const amount18 = parse18(ethers, amount);
    const orderId = toOrderId(ethers, order);
    await (await st.connect(signer).authorizeMint(investor, amount18, orderId)).wait();
    console.log("✅ Mint autorizzato su", dep.address);
  });

task("depositary:authorize-burn", "Finalizza rimborso (DEPOSITARY_ROLE)")
  .addParam("investor")
  .addParam("shares", "Quote da bruciare es. '300'")
  .addParam("order", "ID rimborso usato dalla platform (o 0x...64)")
  .addParam("netpaid", "Importo pagato off-chain es. '300'")
  .setAction(async ({ investor, shares, order, netpaid }, hre: HardhatRuntimeEnvironment) => {
    const { st, dep, ethers } = await getSecurityToken(hre);
    const signer = signerFromEnv(ethers, "DEPOSITARY_PK");
    const shares18 = parse18(ethers, shares);
    const netPaid18 = parse18(ethers, netpaid);
    const orderId = toOrderId(ethers, order);
    await (await st.connect(signer).authorizeBurn(investor, shares18, orderId, netPaid18)).wait();
    console.log("✅ Burn autorizzato su", dep.address);
  });
