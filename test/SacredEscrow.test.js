const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("SacredEscrow", function () {
  // Test constants
  const PLATFORM_X = 1;
  const USER_ID = 12345n;
  const FEE_BPS = 100; // 1%
  const MAX_FEE_BPS = 1000; // 10%
  
  // EIP-712 constants
  const DOMAIN_NAME = "SacredAttester";
  const DOMAIN_VERSION = "1";

  async function deployEscrowFixture() {
    const [owner, attester, feeRecipient, depositor, payout, other] = await ethers.getSigners();
    
    const SacredEscrow = await ethers.getContractFactory("SacredEscrow");
    const escrow = await SacredEscrow.deploy(
      attester.address,
      feeRecipient.address,
      FEE_BPS
    );

    // EIP-712 domain
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await escrow.getAddress()
    };

    // EIP-712 types
    const types = {
      ClaimAttestation: [
        { name: "platformId", type: "uint8" },
        { name: "userId", type: "uint256" },
        { name: "payoutAddress", type: "address" },
        { name: "depositId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint64" }
      ]
    };

    return { escrow, owner, attester, feeRecipient, depositor, payout, other, domain, types };
  }

  async function createDepositFixture() {
    const fixture = await loadFixture(deployEscrowFixture);
    const { escrow, depositor } = fixture;
    
    const depositAmount = ethers.parseEther("1.0");
    const tx = await escrow.connect(depositor).deposit(
      PLATFORM_X,
      USER_ID,
      0, // depositorUserId
      "", // contentUri
      { value: depositAmount }
    );
    
    const receipt = await tx.wait();
    const depositEvent = receipt.logs.find(log => 
      log.fragment && log.fragment.name === "DepositCreated"
    );
    const depositId = depositEvent.args[0];

    return { ...fixture, depositId, depositAmount };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial values", async function () {
      const { escrow, owner, attester, feeRecipient } = await loadFixture(deployEscrowFixture);
      
      expect(await escrow.owner()).to.equal(owner.address);
      expect(await escrow.attester()).to.equal(attester.address);
      expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
      expect(await escrow.feeBps()).to.equal(FEE_BPS);
      expect(await escrow.nextDepositId()).to.equal(1);
    });

    it("Should revert with invalid constructor parameters", async function () {
      const [, attester, feeRecipient] = await ethers.getSigners();
      const SacredEscrow = await ethers.getContractFactory("SacredEscrow");
      
      await expect(
        SacredEscrow.deploy(ethers.ZeroAddress, feeRecipient.address, FEE_BPS)
      ).to.be.revertedWithCustomError(SacredEscrow, "InvalidParams");
      
      await expect(
        SacredEscrow.deploy(attester.address, ethers.ZeroAddress, FEE_BPS)
      ).to.be.revertedWithCustomError(SacredEscrow, "InvalidParams");
      
      await expect(
        SacredEscrow.deploy(attester.address, feeRecipient.address, 1100)
      ).to.be.revertedWithCustomError(SacredEscrow, "FeeTooHigh");
    });
  });

  describe("Deposit Creation", function () {
    it("Should create deposit with correct parameters", async function () {
      const { escrow, depositor } = await loadFixture(deployEscrowFixture);
      
      const depositAmount = ethers.parseEther("1.0");
      const tx = await escrow.connect(depositor).deposit(
        PLATFORM_X,
        USER_ID,
        0,
        "",
        { value: depositAmount }
      );
      
      await expect(tx)
        .to.emit(escrow, "DepositCreated")
        .withArgs(1, depositor.address, PLATFORM_X, USER_ID, depositAmount, 0, "");
      
      const deposit = await escrow.deposits(1);
      expect(deposit.depositorAddress).to.equal(depositor.address);
      expect(deposit.amount).to.equal(depositAmount);
      expect(deposit.claimed).to.be.false;
    });

    it("Should revert with invalid parameters", async function () {
      const { escrow, depositor } = await loadFixture(deployEscrowFixture);
      
      await expect(
        escrow.connect(depositor).deposit(PLATFORM_X, USER_ID, 0, "", { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidParams");
      
      await expect(
        escrow.connect(depositor).deposit(PLATFORM_X, 0, 0, "", { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(escrow, "InvalidParams");
      
      await expect(
        escrow.connect(depositor).deposit(0, USER_ID, 0, "", { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(escrow, "InvalidPlatform");
    });
  });

  describe("Claim Functionality", function () {
    it("Should successfully claim deposit with valid attestation", async function () {
      const { escrow, attester, payout, depositId, depositAmount, domain, types } = await loadFixture(createDepositFixture);
      
      const attestation = {
        platformId: PLATFORM_X,
        userId: USER_ID,
        payoutAddress: payout.address,
        depositId: depositId,
        nonce: 12345n,
        expiry: Math.floor(Date.now() / 1000) + 3600
      };
      
      const signature = await attester.signTypedData(domain, types, attestation);
      
      const feeAmount = depositAmount * BigInt(FEE_BPS) / 10000n;
      const netAmount = depositAmount - feeAmount;
      
      await expect(escrow.claim(depositId, payout.address, attestation, signature))
        .to.emit(escrow, "DepositClaimed")
        .withArgs(depositId, payout.address, netAmount, feeAmount);
      
      const deposit = await escrow.deposits(depositId);
      expect(deposit.claimed).to.be.true;
      expect(await escrow.usedNonces(attestation.nonce)).to.be.true;
    });

    it("Should revert with invalid claims", async function () {
      const { escrow, attester, other, payout, depositId, domain, types } = await loadFixture(createDepositFixture);
      
      // Expired attestation
      let attestation = {
        platformId: PLATFORM_X,
        userId: USER_ID,
        payoutAddress: payout.address,
        depositId: depositId,
        nonce: 12345n,
        expiry: Math.floor(Date.now() / 1000) - 3600
      };
      
      let signature = await attester.signTypedData(domain, types, attestation);
      
      await expect(
        escrow.claim(depositId, payout.address, attestation, signature)
      ).to.be.revertedWithCustomError(escrow, "AttestationExpired");
      
      // Wrong platform
      attestation.expiry = Math.floor(Date.now() / 1000) + 3600;
      attestation.platformId = 2;
      signature = await attester.signTypedData(domain, types, attestation);
      
      await expect(
        escrow.claim(depositId, payout.address, attestation, signature)
      ).to.be.revertedWithCustomError(escrow, "AttestationMismatch");
      
      // Invalid signature
      attestation.platformId = PLATFORM_X;
      signature = await other.signTypedData(domain, types, attestation);
      
      await expect(
        escrow.claim(depositId, payout.address, attestation, signature)
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });

    it("Should prevent nonce reuse", async function () {
      const { escrow, attester, payout, depositId, depositor, domain, types } = await loadFixture(createDepositFixture);
      
      const attestation = {
        platformId: PLATFORM_X,
        userId: USER_ID,
        payoutAddress: payout.address,
        depositId: depositId,
        nonce: 12345n,
        expiry: Math.floor(Date.now() / 1000) + 3600
      };
      
      const signature = await attester.signTypedData(domain, types, attestation);
      await escrow.claim(depositId, payout.address, attestation, signature);
      
      // Create new deposit and try to reuse nonce
      await escrow.connect(depositor).deposit(PLATFORM_X, USER_ID, 0, "", { value: ethers.parseEther("1.0") });
      
      const attestation2 = { ...attestation, depositId: 2n };
      const signature2 = await attester.signTypedData(domain, types, attestation2);
      
      await expect(
        escrow.claim(2, payout.address, attestation2, signature2)
      ).to.be.revertedWithCustomError(escrow, "NonceUsed");
    });
  });

  describe("Refund Functionality", function () {
    it("Should allow depositor to refund", async function () {
      const { escrow, depositor, depositId, depositAmount } = await loadFixture(createDepositFixture);
      
      await expect(escrow.connect(depositor).refund(depositId))
        .to.emit(escrow, "DepositRefunded")
        .withArgs(depositId, depositor.address, depositAmount);
      
      const deposit = await escrow.deposits(depositId);
      expect(deposit.claimed).to.be.true;
    });

    it("Should revert invalid refunds", async function () {
      const { escrow, other, depositId } = await loadFixture(createDepositFixture);
      
      await expect(
        escrow.connect(other).refund(depositId)
      ).to.be.revertedWithCustomError(escrow, "NotDepositor");
      
      await expect(
        escrow.connect(other).refund(999)
      ).to.be.revertedWithCustomError(escrow, "InvalidParams");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update settings", async function () {
      const { escrow, owner, attester, other } = await loadFixture(deployEscrowFixture);
      
      // Update attester
      await expect(escrow.connect(owner).setAttester(other.address))
        .to.emit(escrow, "AttesterUpdated")
        .withArgs(attester.address, other.address);
      
      // Update fee config
      await expect(escrow.connect(owner).setFeeConfig(other.address, 150))
        .to.emit(escrow, "FeeConfigUpdated")
        .withArgs(other.address, 150);
      
      // Transfer ownership
      await expect(escrow.connect(owner).transferOwnership(other.address))
        .to.emit(escrow, "OwnershipTransferred")
        .withArgs(owner.address, other.address);
    });

    it("Should revert admin functions from non-owner", async function () {
      const { escrow, other } = await loadFixture(deployEscrowFixture);
      
      await expect(
        escrow.connect(other).setAttester(other.address)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");
      
      await expect(
        escrow.connect(other).setFeeConfig(other.address, 150)
      ).to.be.revertedWithCustomError(escrow, "NotOwner");
    });

    it("Should revert with invalid admin parameters", async function () {
      const { escrow, owner } = await loadFixture(deployEscrowFixture);
      
      await expect(
        escrow.connect(owner).setAttester(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(escrow, "InvalidParams");
      
      await expect(
        escrow.connect(owner).setFeeConfig(ethers.ZeroAddress, 150)
      ).to.be.revertedWithCustomError(escrow, "InvalidParams");
      
      await expect(
        escrow.connect(owner).setFeeConfig(owner.address, 1100)
      ).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
    });
  });

  describe("Fee Handling", function () {
    it("Should handle zero fees", async function () {
      const [owner, attester, feeRecipient, depositor, payout] = await ethers.getSigners();
      const SacredEscrow = await ethers.getContractFactory("SacredEscrow");
      
      const escrow = await SacredEscrow.deploy(attester.address, feeRecipient.address, 0);
      
      const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await escrow.getAddress()
      };
      
      const types = {
        ClaimAttestation: [
          { name: "platformId", type: "uint8" },
          { name: "userId", type: "uint256" },
          { name: "payoutAddress", type: "address" },
          { name: "depositId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint64" }
        ]
      };
      
      const depositAmount = ethers.parseEther("1.0");
      await escrow.connect(depositor).deposit(PLATFORM_X, USER_ID, 0, "", { value: depositAmount });
      
      const attestation = {
        platformId: PLATFORM_X,
        userId: USER_ID,
        payoutAddress: payout.address,
        depositId: 1n,
        nonce: 12345n,
        expiry: Math.floor(Date.now() / 1000) + 3600
      };
      
      const signature = await attester.signTypedData(domain, types, attestation);
      
      const payoutBalanceBefore = await ethers.provider.getBalance(payout.address);
      const feeRecipientBalanceBefore = await ethers.provider.getBalance(feeRecipient.address);
      
      await escrow.claim(1, payout.address, attestation, signature);
      
      const payoutBalanceAfter = await ethers.provider.getBalance(payout.address);
      const feeRecipientBalanceAfter = await ethers.provider.getBalance(feeRecipient.address);
      
      expect(payoutBalanceAfter - payoutBalanceBefore).to.equal(depositAmount);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.equal(0);
    });

    it("Should handle maximum fees", async function () {
      const [owner, attester, feeRecipient, depositor, payout] = await ethers.getSigners();
      const SacredEscrow = await ethers.getContractFactory("SacredEscrow");
      
      const escrow = await SacredEscrow.deploy(attester.address, feeRecipient.address, MAX_FEE_BPS);
      
      const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await escrow.getAddress()
      };
      
      const types = {
        ClaimAttestation: [
          { name: "platformId", type: "uint8" },
          { name: "userId", type: "uint256" },
          { name: "payoutAddress", type: "address" },
          { name: "depositId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint64" }
        ]
      };
      
      const depositAmount = ethers.parseEther("1.0");
      await escrow.connect(depositor).deposit(PLATFORM_X, USER_ID, 0, "", { value: depositAmount });
      
      const attestation = {
        platformId: PLATFORM_X,
        userId: USER_ID,
        payoutAddress: payout.address,
        depositId: 1n,
        nonce: 12345n,
        expiry: Math.floor(Date.now() / 1000) + 3600
      };
      
      const signature = await attester.signTypedData(domain, types, attestation);
      
      const expectedFee = depositAmount * BigInt(MAX_FEE_BPS) / 10000n;
      const expectedNet = depositAmount - expectedFee;
      
      const payoutBalanceBefore = await ethers.provider.getBalance(payout.address);
      const feeRecipientBalanceBefore = await ethers.provider.getBalance(feeRecipient.address);
      
      await escrow.claim(1, payout.address, attestation, signature);
      
      const payoutBalanceAfter = await ethers.provider.getBalance(payout.address);
      const feeRecipientBalanceAfter = await ethers.provider.getBalance(feeRecipient.address);
      
      expect(payoutBalanceAfter - payoutBalanceBefore).to.equal(expectedNet);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.equal(expectedFee);
    });
  });
});
