# Sacred Escrow Contracts

This package contains the SacredEscrow smart contract - a decentralized escrow system that allows users to deposit native token for specific social media identities and enables verified claims through cryptographic attestations.

## SacredEscrow Contract

The SacredEscrow contract enables secure, trustless escrow for social media interactions. Users can deposit funds targeted at specific platform identities, and recipients can claim these funds using verified attestations.

### Key Features

- **Multi-platform Support**: Supports various social media platforms (Twitter, GitHub, etc.)
- **Cryptographic Verification**: Uses EIP-712 signed attestations for secure claims
- **Fee System**: Configurable protocol fees with maximum cap
- **Refund Mechanism**: Depositors can reclaim unclaimed funds
- **Admin Functions**: Owner-controlled attester and fee configuration

### Core Functions

- `deposit()`: Create escrow deposits for platform identities
- `claim()`: Claim deposits using signed attestations  
- `refund()`: Reclaim unclaimed deposits as depositor
- `setAttester()`: Update attestation signer (admin only)
- `setFeeConfig()`: Configure protocol fees (admin only)

## Development Setup

1. Install dependencies and run tests:

```shell
npm install
npm test
```

2. Deploy to local network:

```shell
npx hardhat node
npm run deploy:local
```

3. Deploy to Polkadot Hub Testnet:

```shell
npm run deploy
```

## Configuration

Copy `.env.example` to `.env` and configure:

- `DEPLOYER_PRIVATE_KEY`: Private key for contract deployment
- `ATTESTER_ADDRESS`: Address that signs claim attestations
- `FEE_RECIPIENT_ADDRESS`: Address that receives protocol fees
- `FEE_BPS`: Protocol fee in basis points (100 = 1%)
- `RPC_URL`: RPC endpoint for target network
