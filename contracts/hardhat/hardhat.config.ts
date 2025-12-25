import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-ignition-ethers";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const mnemonic = process.env.HARDHAT_MNEMONIC;
const accounts = mnemonic ? { mnemonic } : undefined;
const create2Salt =
  process.env.IGNITION_CREATE2_SALT ??
  "0x000000000000000000000000000000000000000000000000000000000000c402";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts
    }
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: create2Salt
      }
    }
  }
};

export default config;
