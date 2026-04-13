// tasks/navSetter.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getNavOracle, signerFromEnv } from "./_helpers";

task("nav:set", "Aggiorna NAV (NAV_SETTER_ROLE)")
  .addParam("nav", "Nuovo NAV uint256 (es 105000)")
  .addParam("doc", "Stringa off-chain da hashare (es. 'nav_report_oct2025_v1')")
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    const { nav, dep, ethers } = await getNavOracle(hre);
    const signer = signerFromEnv(ethers, "NAVSETTER_PK");
    const navValue = BigInt(args.nav);
    const docHash = ethers.keccak256(ethers.toUtf8Bytes(args.doc));
    const tx = await nav.connect(signer).setNav(navValue, docHash);
    const rc = await tx.wait();
    console.log("✅ NAV aggiornato su", dep.address);
    console.log("tx:", rc?.hash);
    console.log("nav:", navValue.toString(), "docHash:", docHash);
  });

task("nav:adj", "Imposta adjBps (NAV_SETTER_ROLE)")
  .addParam("bps", "Basis points (es 25 = +0.25%)")
  .setAction(async ({ bps }, hre: HardhatRuntimeEnvironment) => {
    const { nav, dep, ethers } = await getNavOracle(hre);
    const signer = signerFromEnv(ethers, "NAVSETTER_PK");
    const adj = BigInt(bps);
    const tx = await nav.connect(signer).setAdjBps(adj);
    const rc = await tx.wait();
    console.log("✅ adjBps aggiornato su", dep.address);
    console.log("tx:", rc?.hash, "adjBps:", adj.toString());
  });
