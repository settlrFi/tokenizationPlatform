// tasks/investor.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getSecurityToken, parse18 } from "./_helpers";
import * as dotenv from "dotenv";
dotenv.config();

/**
 * Trasferisce quote dal wallet dell'investitore verso "to".
 * Firma con INVESTOR_PK (o con --pk passato da CLI).
 *
 * Esempi:
 *  npx hardhat investor:transfer --to 0xAbc... --amount "10.5" --network localhost
 *  npx hardhat investor:transfer --to 0xAbc... --amount "1" --pk 0x.... --network localhost
 */
task("investor:transfer", "Trasferisce quote (ERC20 transfer) dal wallet dell'investitore")
  .addParam("to", "Address destinatario")
  .addParam("amount", "Quote da trasferire (es. '10' o '0.5')")
  .addOptionalParam("pk", "Private key esadecimale del mittente (0x...). Se omessa, usa INVESTOR_PK da .env")
  .setAction(async ({ to, amount, pk }, hre: HardhatRuntimeEnvironment) => {
    const { st, dep, ethers } = await getSecurityToken(hre);

    // scegli la chiave: --pk > .env
    const usedPk = (pk as string) || process.env.INVESTOR_PK;
    if (!usedPk) {
      throw new Error("Missing private key. Specifica --pk oppure configura INVESTOR_PK nel file .env");
    }

    const signer = new ethers.Wallet(usedPk, ethers.provider);
    const from = await signer.getAddress();

    // parse amount in 18 decimali (come il tuo token)
    const amount18 = parse18(ethers, amount);

    console.log("SecurityToken @", dep.address);
    console.log(`Trasferisco ${amount} quote`);
    console.log("  from:", from);
    console.log("    to:", to);

    const balBefore = await st.balanceOf(from);
    const tx = await st.connect(signer).transfer(to, amount18);
    const rc = await tx.wait();

    const balAfter = await st.balanceOf(from);
    console.log("✅ Transfer ok. tx:", rc?.hash);
    console.log(
      " saldo mittente:",
      ethers.formatUnits(balBefore, 18),
      "→",
      ethers.formatUnits(balAfter, 18)
    );
  });




task("investor:balance", "Mostra balance/locked/spendable di un account")
  .addParam("addr", "Address da interrogare (0x...)")
  .addOptionalParam("contract", "Override: indirizzo del token (se diverso dal deployment)")
  .setAction(async ({ addr, contract }, hre: HardhatRuntimeEnvironment) => {
    const { st: stFromDep, dep, ethers } = await getSecurityToken(hre);

    // opzionale: permetti di interrogare un token diverso dal deployment
    const st = contract
      ? await ethers.getContractAt("SecurityToken", contract)
      : stFromDep;

    const target = ethers.getAddress(addr); // valida e normalizza

    const [name, symbol, decimals, bal, locked] = await Promise.all([
      st.name(),
      st.symbol(),
      st.decimals(),
      st.balanceOf(target),
      st.lockedOf(target),
    ]);

    const spendable = bal - locked;

    console.log(`SecurityToken ${name} (${symbol}) @ ${contract ?? dep.address}`);
    console.log(`account   : ${target}`);
    console.log(`balance   : ${ethers.formatUnits(bal, decimals)}`);
    console.log(`locked    : ${ethers.formatUnits(locked, decimals)}`);
    console.log(`spendable : ${ethers.formatUnits(spendable, decimals)}`);
  });


  
  