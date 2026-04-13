// scripts/watch-nav.ts
import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("NavOracle");

  const nav: any = await ethers.getContractAt("NavOracle", dep.address);

  console.log("👀 NAV watcher su", dep.address);
  console.log("— Monitoro aggiornamenti NAV e swing pricing —");

  // event NavSet(uint256 nav, bytes32 docHash);
  nav.on("NavSet", (navValue: bigint, docHash: string, evt: any) => {
    console.log("\n[NavSet]");
    console.log(" nav     :", navValue.toString());
    console.log(" docHash :", docHash);
    console.log(" -> NAV aggiornato on-chain dal NAV_SETTER_ROLE.");
  });

  // event AdjBpsSet(uint256 adjBps);
  nav.on("NavAdjSet", (bps: bigint, evt: any) => {
    console.log("\n[AdjBpsSet]");
    console.log(" adjBps :", bps.toString());
    console.log(" -> Fattore di aggiustamento/swing pricing aggiornato.");
  });

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
