import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import { config as Config } from 'dotenv'
import '@nomicfoundation/hardhat-ignition'
import '@appliedblockchain/silentdatarollup-hardhat-plugin'
import { SignatureType } from '@appliedblockchain/silentdatarollup-core'
import './tasks/set-xerc20-limits'
import './tasks/call'

// Load .env file
Config()

const { SILENTDATA_RPC_URL, PRIVATE_KEY, SILENTDATA_CHAIN_ID } = process.env

// The remote network is only configured when its settings are present, so local
// compile and test runs do not need them.
const silentdataNetwork =
  SILENTDATA_RPC_URL && PRIVATE_KEY && SILENTDATA_CHAIN_ID
    ? {
        silentdata: {
          url: SILENTDATA_RPC_URL,
          accounts: [PRIVATE_KEY],
          chainId: Number(SILENTDATA_CHAIN_ID),
          silentdata: {
            authSignatureType: SignatureType.Raw,
          },
        },
      }
    : {}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // Version 0.8.17 is required for the ERC3643 contract
      {
        version: '0.8.17',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: process.env.CREATE2_SALT ?? '0xab5d000000000000000000000000000000000000000000000000000000000000',
      },
    },
  },
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    ...silentdataNetwork,
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
}

export default config
