// scripts/watch-depositary.ts
import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("SecurityToken");

  // cast a any per evitare problemi di tipi sugli eventi
  const st: any = await ethers.getContractAt("SecurityToken", dep.address);

  console.log("👀 Depositary watcher su", dep.address);
  console.log("— In attesa di MintProposed / BurnProposed —");

  // event MintProposed(address indexed investor, uint256 netAmount, bytes32 orderId);
  st.on("MintProposed", (investor: string, netAmount: bigint, orderId: string, evt: any) => {
    console.log("\n[MintProposed]");
    console.log(" investor:", investor);
    console.log(" netAmount:", netAmount.toString(), `(~ ${ethers.formatUnits(netAmount, 18)} shares)`);
    console.log(" orderId :", orderId);

    console.log(" Suggerimento CLI:");
    console.log(
      ` npx hardhat depositary:authorize-mint` +
        ` --investor ${investor}` +
        ` --amount "${ethers.formatUnits(netAmount, 18)}"` +
        ` --order ${orderId}` +
        ` --network localhost`
    );
  });

  // event BurnProposed(address indexed investor, uint256 shares, bytes32 orderId);
  st.on("BurnProposed", (investor: string, shares: bigint, orderId: string, evt: any) => {
    console.log("\n[BurnProposed]");
    console.log(" investor:", investor);
    console.log(" shares  :", shares.toString(), `(~ ${ethers.formatUnits(shares, 18)} shares)`);
    console.log(" orderId :", orderId);

    console.log(" Suggerimento CLI:");
    console.log(
      ` npx hardhat depositary:authorize-burn` +
        ` --investor ${investor}` +
        ` --shares "${ethers.formatUnits(shares, 18)}"` +
        ` --order ${orderId}` +
        ` --netpaid "INSERISCI_IMPORTO_PAGATO"` +
        ` --network localhost`
    );
  });

  // event RedemptionPaid(address indexed investor, uint256 net, bytes32 orderId);
  st.on("RedemptionPaid", (investor: string, net: bigint, orderId: string, evt: any) => {
    console.log("\n[RedemptionPaid]");
    console.log(" investor:", investor);
    console.log(" netPaid :", net.toString(), `(~ ${ethers.formatUnits(net, 18)})`);
    console.log(" orderId :", orderId);
  });

  // tieni vivo il processo
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
