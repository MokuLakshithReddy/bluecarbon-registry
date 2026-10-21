// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlueCarbonRegistry
 * @dev On-chain anchor contract for verified blue-carbon restoration records.
 *
 * Security & Integrity Features:
 * 1. Role-Based Access Control: Only authorized registry verifiers or contract owner can anchor records.
 * 2. Governance Auditing: Verifier authorization/revocation emits indexed governance events.
 * 3. High-Precision Fixed-Point Carbon Storage: Values are stored in milli-tCO2e (kilograms CO2e, scale factor 1,000)
 *    to preserve decimal precision without truncation (e.g., 520.65 tCO2e = 520,650 milli-tCO2e).
 * 4. Immutability: Once a recordHash is anchored, it can never be altered or overwritten.
 */
contract BlueCarbonRegistry {
    /// @notice Number of decimal places used for carbon values (1 milli-tCO2e = 0.001 tCO2e = 1 kg CO2e)
    uint8 public constant CARBON_DECIMALS = 3;
    uint256 public constant CARBON_SCALE_FACTOR = 1000;

    address public owner;
    mapping(address => bool) public isAuthorizedVerifier;

    struct RecordAnchor {
        bytes32 recordHash;
        string projectCode;
        uint256 verifiedCarbonMilliTco2e;
        uint256 blockNumber;
        uint256 timestamp;
        address verifier;
    }

    mapping(bytes32 => RecordAnchor) private _anchors;
    mapping(string => bytes32) private _projectLatestAnchor;

    // Events
    event RecordAnchored(
        bytes32 indexed recordHash,
        string projectCode,
        uint256 verifiedCarbonMilliTco2e,
        uint256 timestamp,
        address indexed verifier
    );

    event VerifierAuthorized(address indexed verifier, address indexed authorizer);
    event VerifierRevoked(address indexed verifier, address indexed revoker);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Custom Errors
    error RecordAlreadyAnchored(bytes32 recordHash);
    error InvalidRecordHash();
    error UnauthorizedVerifier(address caller);
    error OnlyOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyAuthorizedVerifier() {
        if (!isAuthorizedVerifier[msg.sender] && msg.sender != owner) {
            revert UnauthorizedVerifier(msg.sender);
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isAuthorizedVerifier[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit VerifierAuthorized(msg.sender, msg.sender);
    }

    /**
     * @notice Authorizes an address to anchor verified registry records.
     */
    function authorizeVerifier(address verifier) external onlyOwner {
        if (verifier == address(0)) revert ZeroAddress();
        isAuthorizedVerifier[verifier] = true;
        emit VerifierAuthorized(verifier, msg.sender);
    }

    /**
     * @notice Revokes anchoring privileges from an address.
     */
    function revokeVerifier(address verifier) external onlyOwner {
        if (verifier == address(0)) revert ZeroAddress();
        isAuthorizedVerifier[verifier] = false;
        emit VerifierRevoked(verifier, msg.sender);
    }

    /**
     * @notice Transfers contract ownership to a new governor.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Anchors a canonical verified project record hash to the blockchain.
     * @param recordHash The SHA-256 canonical hash of the verified project record.
     * @param projectCode Unique registry project code (e.g., "BC-MNG-0001").
     * @param verifiedCarbonMilliTco2e Confirmed carbon impact in milli-tCO2e (kilograms CO2e).
     */
    function anchorRecord(
        bytes32 recordHash,
        string calldata projectCode,
        uint256 verifiedCarbonMilliTco2e
    ) external onlyAuthorizedVerifier {
        if (recordHash == bytes32(0)) revert InvalidRecordHash();
        if (_anchors[recordHash].timestamp != 0) revert RecordAlreadyAnchored(recordHash);

        _anchors[recordHash] = RecordAnchor({
            recordHash: recordHash,
            projectCode: projectCode,
            verifiedCarbonMilliTco2e: verifiedCarbonMilliTco2e,
            blockNumber: block.number,
            timestamp: block.timestamp,
            verifier: msg.sender
        });

        _projectLatestAnchor[projectCode] = recordHash;

        emit RecordAnchored(
            recordHash,
            projectCode,
            verifiedCarbonMilliTco2e,
            block.timestamp,
            msg.sender
        );
    }

    /**
     * @notice Independent verification check for an anchored hash.
     * @param recordHash The hash to query.
     */
    function verifyRecord(bytes32 recordHash)
        external
        view
        returns (
            bool exists,
            string memory projectCode,
            uint256 verifiedCarbonMilliTco2e,
            uint256 blockNumber,
            uint256 timestamp,
            address verifier
        )
    {
        RecordAnchor memory r = _anchors[recordHash];
        return (
            r.timestamp > 0,
            r.projectCode,
            r.verifiedCarbonMilliTco2e,
            r.blockNumber,
            r.timestamp,
            r.verifier
        );
    }

    /**
     * @notice Returns the latest anchored hash for a project.
     */
    function getLatestAnchor(string calldata projectCode) external view returns (bytes32) {
        return _projectLatestAnchor[projectCode];
    }
}
