// tasks/_helpers.ts
import * as dotenv from "dotenv";
dotenv.config();
import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function getSecurityToken(hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("SecurityToken");
  const st = await ethers.getContractAt("SecurityToken", dep.address);
  return { st, dep, ethers };
}

export async function getNavOracle(hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("NavOracle");
  const nav = await ethers.getContractAt("NavOracle", dep.address);
  return { nav, dep, ethers };
}

export async function getComplianceRegistry(hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("ComplianceRegistry");
  const reg = await ethers.getContractAt("ComplianceRegistry", dep.address);
  return { reg, dep, ethers };
}

export function signerFromEnv(ethers: any, varName: string, provider?: any) {
  const pk = process.env[varName];
  if (!pk) {
    throw new Error(
      `Missing ${varName} in .env. Add ${varName}=0x... to sign transactions.`
    );
  }
  const prov = provider ?? ethers.provider;
  return new ethers.Wallet(pk, prov);
}

export function toOrderId(ethers: any, order: string) {
  // Se già 0x...32 byte, lo accetto. Altrimenti hash della stringa.
  if (/^0x[0-9a-fA-F]{64}$/.test(order)) return order;
  return ethers.id(order);
}

export function fmt18(ethers: any, v: bigint | string) {
  return ethers.formatUnits(v, 18);
}

export function parse18(ethers: any, s: string) {
  return ethers.parseUnits(s, 18);
}
