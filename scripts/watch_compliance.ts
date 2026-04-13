// scripts/watch-compliance.ts
import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("ComplianceRegistry");

  const reg: any = await ethers.getContractAt("ComplianceRegistry", dep.address);

  console.log("👀 Compliance watcher su", dep.address);
  console.log("— Monitoro whitelist / blacklist / KYC expiry —");

  // event WhitelistSet(address indexed investor, bool allowed);
  reg.on("WhitelistSet", (investor: string, allowed: boolean, evt: any) => {
    console.log("\n[WhitelistSet]");
    console.log(" investor:", investor);
    console.log(" allowed :", allowed);
    console.log(" -> L'investitore è (o non è più) autorizzato a operare.");
  });

  // event BlacklistSet(address indexed investor, bool banned);
  reg.on("BlacklistSet", (investor: string, banned: boolean, evt: any) => {
    console.log("\n[BlacklistSet]");
    console.log(" investor:", investor);
    console.log(" banned  :", banned);
    console.log(" -> Questo indirizzo è stato marcato come bloccato/rischioso.");
  });

  // event KycExpirySet(address indexed investor, uint256 expiry);
  reg.on("KycExpirySet", (investor: string, expiry: bigint, evt: any) => {
    console.log("\n[KycExpirySet]");
    console.log(" investor:", investor);
    console.log(" expiry  :", expiry.toString(), "(unix seconds)");
    console.log(" -> Scadenza/validità KYC aggiornata.");
  });

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
