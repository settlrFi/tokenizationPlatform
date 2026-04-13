// scripts/watch-platform.ts
import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("SecurityToken");

  const st: any = await ethers.getContractAt("SecurityToken", dep.address);

  console.log("👀 Platform watcher su", dep.address);
  console.log("— Monitoro sottoscrizioni approvate, rimborsi pagati e movimenti supply —");

  const ZERO = "0x0000000000000000000000000000000000000000";

  // Mint / Burn effettivi via Transfer standard ERC20
  st.on("Transfer", (from: string, to: string, value: bigint, evt: any) => {
    if (from === ZERO) {
      console.log("\n[Mint Executed]");
      console.log(" to    :", to);
      console.log(" amount:", value.toString(), `(~ ${ethers.formatUnits(value, 18)} shares)`);
    } else if (to === ZERO) {
      console.log("\n[Burn Executed]");
      console.log(" from  :", from);
      console.log(" amount:", value.toString(), `(~ ${ethers.formatUnits(value, 18)} shares)`);
    }
  });

  // event Subscription(address indexed investor, uint256 gross, uint256 net, bytes32 orderId);
  st.on(
    "Subscription",
    (investor: string, gross: bigint, net: bigint, orderId: string, evt: any) => {
      console.log("\n[Subscription Finalized]");
      console.log(" investor:", investor);
      console.log(" gross   :", gross.toString(), `(~ ${ethers.formatUnits(gross, 18)})`);
      console.log(" net     :", net.toString(), `(~ ${ethers.formatUnits(net, 18)})`);
      console.log(" orderId :", orderId);
      console.log(" -> La sottoscrizione è stata autorizzata dal depositario e le quote sono state mintate.");
    }
  );

  // event RedemptionRequested(address indexed investor, uint256 shares, bytes32 orderId);
  st.on(
    "RedemptionRequested",
    (investor: string, shares: bigint, orderId: string, evt: any) => {
      console.log("\n[RedemptionRequested]");
      console.log(" investor:", investor);
      console.log(" shares  :", shares.toString(), `(~ ${ethers.formatUnits(shares, 18)} shares)`);
      console.log(" orderId :", orderId);
      console.log(" -> Questa è la richiesta iniziale di rimborso registrata dalla platform.");
    }
  );

  // event RedemptionPaid(address indexed investor, uint256 net, bytes32 orderId);
  st.on(
    "RedemptionPaid",
    (investor: string, net: bigint, orderId: string, evt: any) => {
      console.log("\n[RedemptionPaid]");
      console.log(" investor:", investor);
      console.log(" netPaid :", net.toString(), `(~ ${ethers.formatUnits(net, 18)})`);
      console.log(" orderId :", orderId);
      console.log(" -> Il depositario ha autorizzato il burn e ha pagato l'investitore off-chain.");
    }
  );

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
