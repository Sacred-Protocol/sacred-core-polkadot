require("@nomicfoundation/hardhat-toolbox")
require("@parity/hardhat-polkadot")
require('dotenv').config()

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000
            },
            viaIR: true
        }
    },
    networks: {
        hardhat: {
            // Local hardhat network for testing
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
        },
        polkadotHubTestnet: {
            polkavm: true,
            url: process.env.RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io',
            accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
            chainId: 420420422,
            gasPrice: 'auto',
            gas: 'auto',
        },
    },
}
