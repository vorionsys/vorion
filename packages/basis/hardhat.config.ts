import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },

    // Ethereum Sepolia Testnet (uses ETH)
    sepolia: {
      url:
        process.env.SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      accounts:
        process.env.PRIVATE_KEY &&
        process.env.PRIVATE_KEY.startsWith("0x") &&
        process.env.PRIVATE_KEY.length === 66
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 11155111,
    },

    // Polygon Amoy Testnet
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts:
        process.env.PRIVATE_KEY &&
        process.env.PRIVATE_KEY.startsWith("0x") &&
        process.env.PRIVATE_KEY.length === 66
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 80002,
      gasPrice: 30000000000, // 30 gwei
    },

    // Polygon Mainnet (uses POL token)
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts:
        process.env.PRIVATE_KEY &&
        process.env.PRIVATE_KEY.startsWith("0x") &&
        process.env.PRIVATE_KEY.length === 66
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 137,
      gasPrice: 50000000000, // 50 gwei
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
