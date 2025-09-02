// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SacredEscrow
 * @dev A decentralized escrow contract that allows users to deposit funds for specific social media identities
 * and enables verified claims through cryptographic attestations. Supports multiple platforms and includes
 * fee mechanisms and refund capabilities.
 */
contract SacredEscrow is ReentrancyGuard {
    using ECDSA for bytes32;
    
    /// @dev The owner of the contract with administrative privileges
    address public owner;

    /**
     * @dev Represents an escrow deposit made for a specific social media identity
     * @param depositorAddress The address that made the deposit
     * @param amount The amount of ETH deposited
     * @param platformId The social media platform identifier (1=Twitter, 2=GitHub, etc.)
     * @param recipientUserId The user ID on the platform who can claim this deposit
     * @param depositorUserId The depositor's user ID on the platform (optional, 0 for anonymous deposits)
     * @param contentUri URI to content that triggered this deposit (e.g., tweet, post, or other identifier)
     * @param claimed Whether this deposit has been claimed or refunded
     */
    struct Deposit {
        address depositorAddress;
        uint256 amount;
        uint8 platformId;
        uint256 recipientUserId;
        uint256 depositorUserId;
        string contentUri;
        bool claimed;
    }

    /**
     * @dev Cryptographic attestation structure for claiming deposits
     * @param platformId The social media platform identifier
     * @param userId The user ID on the platform making the claim
     * @param payoutAddress The address where funds should be sent
     * @param depositId The ID of the deposit being claimed
     * @param nonce Unique nonce to prevent replay attacks
     * @param expiry Timestamp after which this attestation expires
     */
    struct ClaimAttestation {
        uint8 platformId;
        uint256 userId;
        address payoutAddress;
        uint256 depositId;
        uint256 nonce;
        uint64 expiry;
    }

    /// @dev EIP-712 type hash for ClaimAttestation struct
    bytes32 public constant CLAIM_ATTESTATION_TYPEHASH =
        keccak256("ClaimAttestation(uint8 platformId,uint256 userId,address payoutAddress,uint256 depositId,uint256 nonce,uint64 expiry)");

    /// @dev Maximum fee in basis points (10% = 1000 bps)
    uint16 public constant MAX_FEE_BPS = 1000;
    


    /// @dev EIP-712 domain type hash for signature verification
    bytes32 private constant DOMAIN_TYPEHASH = 
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    
    /// @dev Counter for generating unique deposit IDs
    uint256 public nextDepositId = 1;
    
    /// @dev Mapping from deposit ID to deposit details
    mapping(uint256 => Deposit) public deposits;
    
    /// @dev Mapping to track used nonces to prevent replay attacks
    mapping(uint256 => bool) public usedNonces;
    
    /// @dev Address authorized to sign claim attestations
    address public attester;
    
    /// @dev Address that receives protocol fees
    address public feeRecipient;
    
    /// @dev Protocol fee in basis points (e.g., 100 = 1%)
    uint16 public feeBps;

    /// @dev Emitted when a new deposit is created
    /// @param depositId Unique identifier for the deposit
    /// @param depositorAddress Address that made the deposit
    /// @param platformId Social media platform identifier (1=Twitter, 2=GitHub, etc.)
    /// @param recipientUserId Recipient's user ID on the platform (must be > 0)
    /// @param amount Amount of ETH deposited
    /// @param depositorUserId Depositor's user ID on the platform (0 for anonymous deposits)
    /// @param contentUri URI to related content that triggered this deposit
    event DepositCreated(uint256 indexed depositId, address indexed depositorAddress, uint8 indexed platformId, uint256 recipientUserId, uint256 amount, uint256 depositorUserId, string contentUri);
    
    /// @dev Emitted when a deposit is refunded to the depositor
    /// @param depositId The deposit being refunded
    /// @param to Address receiving the refund
    /// @param amount Amount being refunded
    event DepositRefunded(uint256 indexed depositId, address indexed to, uint256 amount);
    
    /// @dev Emitted when a deposit is successfully claimed
    /// @param depositId The deposit being claimed
    /// @param payoutAddress Address receiving the payout
    /// @param netAmount Amount sent to the recipient after fees
    /// @param feeAmount Amount collected as protocol fee
    event DepositClaimed(uint256 indexed depositId, address indexed payoutAddress, uint256 netAmount, uint256 feeAmount);
    
    /// @dev Emitted when the attester address is updated
    /// @param previous Previous attester address
    /// @param current New attester address
    event AttesterUpdated(address indexed previous, address indexed current);
    
    /// @dev Emitted when fee configuration is updated
    /// @param feeRecipient Address that receives fees
    /// @param feeBps Fee amount in basis points
    event FeeConfigUpdated(address indexed feeRecipient, uint16 feeBps);
    
    /// @dev Emitted when contract ownership is transferred
    /// @param previousOwner Previous owner address
    /// @param newOwner New owner address
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @dev Thrown when invalid parameters are provided
    error InvalidParams();
    
    /// @dev Thrown when an invalid platform identifier is used
    error InvalidPlatform();
    
    /// @dev Thrown when attempting to operate on an already finalized deposit
    error AlreadyFinalized();
    
    /// @dev Thrown when caller is not the depositor for a refund operation
    error NotDepositor();
    

    
    /// @dev Thrown when a claim attestation has expired
    error AttestationExpired();
    
    /// @dev Thrown when attempting to reuse a nonce
    error NonceUsed();
    
    /// @dev Thrown when signature verification fails
    error InvalidSignature();
    
    /// @dev Thrown when ETH transfer fails
    error TransferFailed();
    
    /// @dev Thrown when fee exceeds maximum allowed
    error FeeTooHigh();
    
    /// @dev Thrown when attestation data doesn't match deposit data
    error AttestationMismatch();
    
    /// @dev Thrown when caller is not the contract owner
    error NotOwner();
    
    /// @dev Restricts function access to contract owner only
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /**
     * @dev Initializes the contract with required parameters
     * @param attesterAddress Address authorized to sign claim attestations
     * @param feeRecipientAddress Address that will receive protocol fees (can be zero if no fees)
     * @param feeBasisPoints Protocol fee in basis points (max 1000 = 10%)
     */
    constructor(address attesterAddress, address feeRecipientAddress, uint16 feeBasisPoints) {
        if (attesterAddress == address(0)) revert InvalidParams();
        if (feeBasisPoints > 0 && feeRecipientAddress == address(0)) revert InvalidParams();
        if (feeBasisPoints > MAX_FEE_BPS) revert FeeTooHigh();
        
        owner = msg.sender;
        attester = attesterAddress;
        feeRecipient = feeRecipientAddress;
        feeBps = feeBasisPoints;
        
        emit OwnershipTransferred(address(0), msg.sender);
        emit AttesterUpdated(address(0), attesterAddress);
        emit FeeConfigUpdated(feeRecipientAddress, feeBasisPoints);
    }

    /**
     * @dev Creates a new escrow deposit for a specific social media identity
     * @param platformId The social media platform identifier (1=Twitter, 2=GitHub, etc.)
     * @param recipientUserId The user ID on the platform who can claim this deposit (must be > 0)
     * @param depositorUserId The depositor's user ID on the platform (optional, 0 for anonymous deposits)
     * @param contentUri URI to content that triggered this deposit (e.g., tweet, post, or other identifier)
     * @return depositId The unique identifier for the created deposit
     */
    function deposit(uint8 platformId, uint256 recipientUserId, uint256 depositorUserId, string calldata contentUri) external payable returns (uint256 depositId) {
        if (msg.value == 0 || recipientUserId == 0) revert InvalidParams();
        if (platformId == 0) revert InvalidPlatform();

        depositId = nextDepositId++;
        deposits[depositId] = Deposit(msg.sender, msg.value, platformId, recipientUserId, depositorUserId, contentUri, false);
        emit DepositCreated(depositId, msg.sender, platformId, recipientUserId, msg.value, depositorUserId, contentUri);
    }

    /**
     * @dev Allows the depositor to refund their deposit at any time before it's claimed
     * @param depositId The ID of the deposit to refund
     * @notice Can only be called by the original depositor
     * @notice Marks the deposit as claimed to prevent future operations
     */
    function refund(uint256 depositId) external nonReentrant {
        Deposit storage deposit = deposits[depositId];
        if (deposit.depositorAddress == address(0)) revert InvalidParams();
        if (deposit.claimed) revert AlreadyFinalized();
        if (msg.sender != deposit.depositorAddress) revert NotDepositor();

        deposit.claimed = true;
        (bool success, ) = deposit.depositorAddress.call{value: deposit.amount}("");
        if (!success) revert TransferFailed();
        emit DepositRefunded(depositId, deposit.depositorAddress, deposit.amount);
    }

    /**
     * @dev Claims a deposit using a cryptographically signed attestation
     * @param depositId The ID of the deposit to claim
     * @param payoutAddress The address where funds should be sent
     * @param attestation The claim attestation containing verification data
     * @param signature The attester's signature over the attestation
     * @notice Verifies the attestation matches the deposit and signature is valid
     * @notice Deducts protocol fees before sending funds to the payout address
     */
    function claim(uint256 depositId, address payoutAddress, ClaimAttestation calldata attestation, bytes calldata signature) external nonReentrant {
        if (payoutAddress == address(0)) revert InvalidParams();
        if (block.timestamp > attestation.expiry) revert AttestationExpired();
        if (usedNonces[attestation.nonce]) revert NonceUsed();

        Deposit storage deposit = deposits[depositId];
        if (deposit.depositorAddress == address(0)) revert InvalidParams();
        if (deposit.claimed) revert AlreadyFinalized();

        if (deposit.platformId != attestation.platformId || deposit.recipientUserId != attestation.userId) {
            revert AttestationMismatch();
        }
        if (attestation.depositId != depositId || attestation.payoutAddress != payoutAddress) {
            revert AttestationMismatch();
        }

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), keccak256(abi.encode(CLAIM_ATTESTATION_TYPEHASH, attestation.platformId, attestation.userId, attestation.payoutAddress, attestation.depositId, attestation.nonce, attestation.expiry))));
        
        if (digest.recover(signature) != attester) revert InvalidSignature();

        deposit.claimed = true;
        usedNonces[attestation.nonce] = true;

        uint256 fee = (deposit.amount * feeBps) / 10_000;
        uint256 net = deposit.amount - fee;

        if (fee > 0) {
            (bool feeTransferSuccess, ) = feeRecipient.call{value: fee}("");
            if (!feeTransferSuccess) revert TransferFailed();
        }
        
        (bool payoutTransferSuccess, ) = payoutAddress.call{value: net}("");
        if (!payoutTransferSuccess) revert TransferFailed();
        emit DepositClaimed(depositId, payoutAddress, net, fee);
    }

    /**
     * @dev Updates the attester address (admin only)
     * @param newAttester New attester address that will sign claim attestations
     * @notice Only the contract owner can call this function
     */
    function setAttester(address newAttester) external onlyOwner {
        if (newAttester == address(0)) revert InvalidParams();
        address prev = attester;
        attester = newAttester;
        emit AttesterUpdated(prev, newAttester);
    }

    /**
     * @dev Updates fee configuration (admin only)
     * @param newFeeRecipient New address that will receive protocol fees (can be zero if no fees)
     * @param newFeeBps New fee in basis points (max 1000 = 10%)
     * @notice Only the contract owner can call this function
     */
    function setFeeConfig(address newFeeRecipient, uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > 0 && newFeeRecipient == address(0)) revert InvalidParams();
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeRecipient = newFeeRecipient;
        feeBps = newFeeBps;
        emit FeeConfigUpdated(newFeeRecipient, newFeeBps);
    }


    /**
     * @dev Transfers contract ownership to a new address (admin only)
     * @param newOwner Address of the new contract owner (must be non-zero)
     * @notice Only the current owner can call this function
     * @notice This is a one-way operation - choose the new owner carefully
     * @notice To renounce ownership completely, use renounceOwnership() instead
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidParams();
        address prev = owner;
        owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
    }

    /**
     * @dev Renounces contract ownership, making the contract ownerless (admin only)
     * @notice Only the current owner can call this function
     * @notice This is a one-way operation that cannot be undone
     * @notice After calling this, no admin functions can ever be called again
     */
    function renounceOwnership() external onlyOwner {
        address prev = owner;
        owner = address(0);
        emit OwnershipTransferred(prev, address(0));
    }


    /**
     * @dev Generates the EIP-712 domain separator for signature verification
     * @return The domain separator hash used in claim attestation signatures
     * @notice This is used internally for verifying claim attestation signatures
     */
    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("SacredAttester")), keccak256(bytes("1")), block.chainid, address(this)));
    }
}
