const { ethers } = require("hardhat");

// Load environment variables from .env file
require('dotenv').config();

async function main() {
    // Get constructor parameters from environment
    const attester = process.env.ATTESTER_ADDRESS;
    const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || "0x0000000000000000000000000000000000000000";
    const feeBps = process.env.FEE_BPS || 0;

    // Validate required parameters
    if (!attester) {
        throw new Error('ATTESTER_ADDRESS environment variable is required');
    }
    if (feeBps > 0 && feeRecipient === "0x0000000000000000000000000000000000000000") {
        throw new Error('FEE_RECIPIENT_ADDRESS environment variable is required when fees are enabled');
    }

    console.log("Deploying SacredEscrow with parameters:");
    console.log("Attester:", attester);
    console.log("Fee Recipient:", feeRecipient);
    console.log("Fee:", (feeBps / 100) + "%");

    // Get the contract factory
    const SacredEscrow = await ethers.getContractFactory("SacredEscrow");
    
    // Deploy the contract
    const escrow = await SacredEscrow.deploy(attester, feeRecipient, feeBps);
    
    // Wait for deployment to complete
    await escrow.waitForDeployment();
    
    const contractAddress = await escrow.getAddress();
    console.log("SacredEscrow deployed to:", contractAddress);
    
    // Save deployment info
    const deploymentInfo = {
        contractAddress,
        attester,
        feeRecipient,
        feeBps,
        network: (await ethers.provider.getNetwork()).name,
        chainId: (await ethers.provider.getNetwork()).chainId,
        deployedAt: new Date().toISOString()
    };
    
    console.log("Deployment completed successfully!");
    console.log("Contract address:", contractAddress);
    
    return deploymentInfo;
}

// Execute deployment if this script is run directly
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = main;
