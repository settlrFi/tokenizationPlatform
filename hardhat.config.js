require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
require("@openzeppelin/hardhat-upgrades");

const {
  RPC_URL,
  PRIVATE_KEY,
  PRIVATE_KEYS,
  SEPOLIA_RPC_URL,
  SEPOLIA_PRIVATE_KEY,
  SEPOLIA_PRIVATE_KEYS,
  ETHERSCAN_API_KEY,
} = process.env;

const hardhatSources = process.env.HARDHAT_SOURCES || "./src";

function parseAccounts(...rawValues) {
  const seen = new Set();
  return rawValues
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .map((value) => {
      if (/^[0-9a-fA-F]{64}$/.test(value)) return `0x${value}`;
      return value;
    })
    .filter((value) => /^0x[0-9a-fA-F]{64}$/.test(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

const localAccounts = parseAccounts(PRIVATE_KEYS, PRIVATE_KEY);
const sepoliaAccounts = parseAccounts(SEPOLIA_PRIVATE_KEYS, SEPOLIA_PRIVATE_KEY);

module.exports = {
    solidity: {
    compilers: [{
      version: "0.8.0",
      settings: {
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
        viaIR: true,
      }
    },
    {
      version: "0.8.19",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
          details: { yul: false },
        },
        viaIR: true,
      }
    },
    {
      version: "0.8.20",
      settings: {
        evmVersion: "cancun",
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
      }
    },
    {
      version: "0.8.23",
      settings: {
        evmVersion: "cancun",
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
      }
    },
    {
      version: "0.8.24",
      settings: {
        evmVersion: "cancun",
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
      }
    },
    {
      version: "0.8.27",
      settings: {
        evmVersion: "cancun",
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
      }
    },
    {
      version: "0.8.26",
      settings: {
        evmVersion: "cancun",
        optimizer: {
          enabled: true,
          runs: 5000,
          details: { yul: false },
        },
      }
    }]
  },
  paths: {
    sources: hardhatSources,
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  allowUnlimitedContractSize: true,
  networks: {
    local: {
      url: RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: localAccounts.length ? localAccounts : undefined
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || RPC_URL || "",
      chainId: 11155111,
      accounts: sepoliaAccounts.length ? sepoliaAccounts : undefined
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || undefined,
  }
};
