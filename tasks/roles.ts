// tasks/roles.ts
import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

async function getToken(hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const dep = await deployments.get("SecurityToken");
  const st  = await ethers.getContractAt("SecurityToken", dep.address);
  return { st, dep, ethers };
}

async function roleIds(st: any) {
  const entries = await Promise.all([
    ["DEFAULT_ADMIN_ROLE", st.DEFAULT_ADMIN_ROLE?.() ?? st.callStatic.DEFAULT_ADMIN_ROLE?.()],
    ["PLATFORM_ROLE",      st.PLATFORM_ROLE()],
    ["DEPOSITARY_ROLE",    st.DEPOSITARY_ROLE()],
    ["COMPLIANCE_ROLE",    st.COMPLIANCE_ROLE()],
    ["REGISTRY_ROLE",      st.REGISTRY_ROLE()],
    ["PAUSER_ROLE",        st.PAUSER_ROLE()],
    ["FORCED_TRANSFER_ROLE", st.FORCED_TRANSFER_ROLE?.()],
  ]);
  const map = new Map<string, string>();
  for (const [name, id] of entries) if (id) map.set(name, id);
  return map;
}

task("roles:list", "Lista membri correnti per ogni ruolo")
  .setAction(async (_args, hre) => {
    const { st, ethers, dep } = await getToken(hre);
    const ids = await roleIds(st);

    // ricostruisci stato da eventi
    const grants = await st.queryFilter(st.filters.RoleGranted(null, null, null), 0, "latest");
    const revoks = await st.queryFilter(st.filters.RoleRevoked(null, null, null), 0, "latest");

    const byRole = new Map<string, Set<string>>();

    const add = (rid: string, acc: string) => {
      const set = byRole.get(rid) ?? new Set<string>();
      set.add(ethers.getAddress(acc));
      byRole.set(rid, set);
    };
    const del = (rid: string, acc: string) => {
      const set = byRole.get(rid);
      if (set) set.delete(ethers.getAddress(acc));
    };

    grants.forEach((e: any) => add(e.args.role, e.args.account));
    revoks.forEach((e: any) => del(e.args.role, e.args.account));

    console.log(`SecurityToken @ ${dep.address}\n`);
    for (const [name, rid] of ids) {
      const members = Array.from(byRole.get(rid) ?? []);
      console.log(`${name}:`);
      if (members.length === 0) console.log("  (nessuno)");
      else members.forEach(a => console.log(`  - ${a}`));
    }
  });

task("roles:has", "Verifica se un address ha un ruolo")
  .addParam("role").addParam("addr")
  .setAction(async ({ role, addr }, hre) => {
    const { st, ethers } = await getToken(hre);
    const ids = await roleIds(st);
    const rid = ids.get(role.toUpperCase());
    if (!rid) throw new Error(`Ruolo sconosciuto: ${role}`);
    console.log(await st.hasRole(rid, ethers.getAddress(addr)) ? "SI" : "NO");
  });