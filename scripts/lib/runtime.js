const { getAddress } = require("ethers");

function normalizeAddress(value) {
  if (!value) return "";
  try {
    return getAddress(String(value).trim());
  } catch {
    return "";
  }
}

function resolveRole(signers, index, envKey, fallbackSigner) {
  const configuredAddress = normalizeAddress(process.env[envKey]);
  const indexedSigner = signers[index] || null;
  const signer = indexedSigner || fallbackSigner;
  const signerAddress = signer ? normalizeAddress(signer.address) : "";
  const address = configuredAddress || signerAddress;
  const hasSigner = !!signer && !!address && signerAddress === address;
  return { envKey, address, signer, hasSigner };
}

function requireSigner(role, label) {
  if (role.hasSigner && role.signer) return role.signer;
  throw new Error(
    `${label} address ${role.address || "(missing)"} is not backed by a loaded signer. ` +
      `Set ${role.envKey} to the deployer address or include that private key in SEPOLIA_PRIVATE_KEYS/PRIVATE_KEYS.`
  );
}

async function getRuntime(hre) {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error("No signer available. Configure PRIVATE_KEY or SEPOLIA_PRIVATE_KEY.");
  }

  const admin = signers[0];

  return {
    admin,
    signers,
    complianceOfficer: resolveRole(signers, 1, "COMPLIANCE_OFFICER_ADDRESS", admin),
    oracleUpdater: resolveRole(signers, 1, "ORACLE_UPDATER_ADDRESS", admin),
    maker: resolveRole(signers, 1, "MAKER_ADDRESS", admin),
    depositary: resolveRole(signers, 2, "DEPOSITARY_ADDRESS", admin),
    platform: resolveRole(signers, 3, "PLATFORM_ADDRESS", admin),
    treasury: resolveRole(signers, 4, "TREASURY_ADDRESS", admin),
    corpActionOperator: resolveRole(signers, 5, "CORP_ACTION_OPERATOR_ADDRESS", admin),
  };
}

module.exports = {
  getRuntime,
  normalizeAddress,
  requireSigner,
};
