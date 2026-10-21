// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlueCarbonRegistry
 * @dev Institutional-grade on-chain registry & credit anchor contract for verified blue-carbon restoration projects.
 *
 * Core Capabilities:
 * 1. Role-Based Access Control (RBAC):
 *    - DEFAULT_ADMIN_ROLE: Governance, role management, and timelock execution.
 *    - VERIFIER_ROLE: Certified verification bodies authorized to anchor records and mint batches.
 *    - ORACLE_ROLE: MRV sensor/satellite oracle networks feeding telemetry.
 *    - AUDITOR_ROLE: Independent oversight auditors for compliance sign-offs.
 * 2. Real Bound Timelock Governance:
 *    - Queued operations bind exact actionType, target address, and role.
 *    - Optional strict timelock enforcement mode closes immediate administrative bypass paths.
 * 3. Batch-Level Credit Standards & Ownership-Bound Retirement:
 *    - Tracks per-wallet balances (balanceOf[recordHash][wallet]).
 *    - Irreversible retirement deducts strictly from caller's token balance.
 *    - Automatic Permanence Buffer Pool withholding (default 15% non-permanence risk reserve).
 *    - Conflict-Free Anchor Validation: Rejects batch mints if existing anchor quantity or project code disagrees.
 * 4. Security & Gas Efficiency:
 *    - Non-reentrant execution guards.
 *    - Custom errors instead of string reverts to minimize gas overhead.
 *    - High-precision fixed-point scaling (milli-tCO2e = kilograms CO2e, scale factor 1,000).
 */
contract BlueCarbonRegistry {
    // -------------------------------------------------------------------------
    // Constants & Precision
    // -------------------------------------------------------------------------
    uint8 public constant CARBON_DECIMALS = 3;
    uint256 public constant CARBON_SCALE_FACTOR = 1000;
    uint256 public constant BUFFER_POOL_PERCENT = 15; // 15% mandatory risk buffer withholding
    uint256 public constant TIMELOCK_DELAY = 2 days;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    enum AdminActionType {
        AUTHORIZE_VERIFIER,
        REVOKE_VERIFIER,
        GRANT_ROLE,
        REVOKE_ROLE,
        TRANSFER_OWNERSHIP,
        SET_TIMELOCK_ENFORCEMENT
    }

    // -------------------------------------------------------------------------
    // Storage Structures
    // -------------------------------------------------------------------------
    address public owner;
    bool public timelockEnforced;
    mapping(address => bool) public isAuthorizedVerifier;
    mapping(bytes32 => mapping(address => bool)) private _roles;

    // Per-batch per-wallet token balance (Ownership-Bound Credits)
    mapping(bytes32 => mapping(address => uint256)) public balanceOf;

    struct RecordAnchor {
        bytes32 recordHash;
        string projectCode;
        uint256 verifiedCarbonMilliTco2e;
        uint256 blockNumber;
        uint256 timestamp;
        address verifier;
    }

    struct CreditBatch {
        bytes32 recordHash;
        string projectCode;
        uint256 vintageYear;
        string ecosystem;
        string methodology;
        string verificationBody;
        uint256 totalMintedMilli;
        uint256 circulatingMilli;
        uint256 bufferPoolMilli;
        uint256 retiredMilli;
        bool exists;
    }

    struct RetirementCertificate {
        bytes32 certificateId;
        bytes32 recordHash;
        address retiree;
        string beneficiary;
        string retirementReason;
        uint256 amountMilliTco2e;
        uint256 timestamp;
    }

    struct QueuedAction {
        bytes32 actionHash;
        AdminActionType actionType;
        address target;
        bytes32 role;
        uint256 readyTimestamp;
        bool executed;
    }

    mapping(bytes32 => RecordAnchor) private _anchors;
    mapping(string => bytes32) private _projectLatestAnchor;
    mapping(bytes32 => CreditBatch) private _creditBatches;
    mapping(bytes32 => RetirementCertificate) private _certificates;
    mapping(bytes32 => QueuedAction) public queuedActions;
    mapping(bytes32 => uint256) public genericTimelocks;

    uint256 private _reentrancyStatus;
    uint256 private _retirementNonce;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event RecordAnchored(
        bytes32 indexed recordHash,
        string projectCode,
        uint256 verifiedCarbonMilliTco2e,
        uint256 timestamp,
        address indexed verifier
    );

    event CreditBatchMinted(
        bytes32 indexed recordHash,
        string projectCode,
        uint256 totalMintedMilli,
        uint256 circulatingMilli,
        uint256 bufferPoolMilli,
        uint256 vintageYear,
        address indexed recipient
    );

    event CreditsTransferred(
        bytes32 indexed recordHash,
        address indexed from,
        address indexed to,
        uint256 amountMilliTco2e
    );

    event CreditsRetired(
        bytes32 indexed certificateId,
        bytes32 indexed recordHash,
        address indexed retiree,
        string beneficiary,
        uint256 amountMilliTco2e,
        string retirementReason,
        uint256 timestamp
    );

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event VerifierAuthorized(address indexed verifier, address indexed authorizer);
    event VerifierRevoked(address indexed verifier, address indexed revoker);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event AdminActionScheduled(
        bytes32 indexed actionHash,
        uint8 indexed actionType,
        address indexed target,
        bytes32 role,
        uint256 readyTimestamp
    );
    event AdminActionExecuted(
        bytes32 indexed actionHash,
        uint8 indexed actionType,
        address indexed target,
        bytes32 role
    );
    event TimelockEnforcementUpdated(bool enforced);

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------
    error RecordAlreadyAnchored(bytes32 recordHash);
    error InvalidRecordHash();
    error InvalidCarbonQuantity();
    error AnchorQuantityMismatch(uint256 expected, uint256 actual);
    error AnchorProjectMismatch(string expected, string actual);
    error UnauthorizedVerifier(address caller);
    error UnauthorizedRole(bytes32 role, address caller);
    error OnlyOwner();
    error ZeroAddress();
    error InsufficientBalance(uint256 requested, uint256 available);
    error BatchNotFound(bytes32 recordHash);
    error TimelockPending(uint256 readyTimestamp);
    error TimelockNotScheduled();
    error TimelockAlreadyExecuted();
    error TimelockEnforcedUseQueuedAction();
    error ActionAlreadyQueued(bytes32 actionHash);
    error ReentrancyGuard();

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender] && msg.sender != owner) {
            revert UnauthorizedRole(role, msg.sender);
        }
        _;
    }

    modifier onlyAuthorizedVerifier() {
        if (!isAuthorizedVerifier[msg.sender] && !_roles[VERIFIER_ROLE][msg.sender] && msg.sender != owner) {
            revert UnauthorizedVerifier(msg.sender);
        }
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == 2) revert ReentrancyGuard();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor() {
        owner = msg.sender;
        _reentrancyStatus = 1;

        // Initialize admin and verifier roles
        _roles[DEFAULT_ADMIN_ROLE][msg.sender] = true;
        _roles[VERIFIER_ROLE][msg.sender] = true;
        isAuthorizedVerifier[msg.sender] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit RoleGranted(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
        emit RoleGranted(VERIFIER_ROLE, msg.sender, msg.sender);
        emit VerifierAuthorized(msg.sender, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Access Control Functions
    // -------------------------------------------------------------------------
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account] || account == owner;
    }

    function setTimelockEnforcement(bool enforced) external onlyOwner {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        timelockEnforced = enforced;
        emit TimelockEnforcementUpdated(enforced);
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        if (account == address(0)) revert ZeroAddress();
        _roles[role][account] = true;
        if (role == VERIFIER_ROLE) {
            isAuthorizedVerifier[account] = true;
            emit VerifierAuthorized(account, msg.sender);
        }
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        if (account == address(0)) revert ZeroAddress();
        _roles[role][account] = false;
        if (role == VERIFIER_ROLE) {
            isAuthorizedVerifier[account] = false;
            emit VerifierRevoked(account, msg.sender);
        }
        emit RoleRevoked(role, account, msg.sender);
    }

    function authorizeVerifier(address verifier) external onlyOwner {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        if (verifier == address(0)) revert ZeroAddress();
        isAuthorizedVerifier[verifier] = true;
        _roles[VERIFIER_ROLE][verifier] = true;
        emit VerifierAuthorized(verifier, msg.sender);
    }

    function revokeVerifier(address verifier) external onlyOwner {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        if (verifier == address(0)) revert ZeroAddress();
        isAuthorizedVerifier[verifier] = false;
        _roles[VERIFIER_ROLE][verifier] = false;
        emit VerifierRevoked(verifier, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (timelockEnforced) revert TimelockEnforcedUseQueuedAction();
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        if (oldOwner != newOwner) {
            _roles[DEFAULT_ADMIN_ROLE][oldOwner] = false;
            _roles[VERIFIER_ROLE][oldOwner] = false;
            isAuthorizedVerifier[oldOwner] = false;
            emit RoleRevoked(DEFAULT_ADMIN_ROLE, oldOwner, msg.sender);
        }
        _roles[DEFAULT_ADMIN_ROLE][newOwner] = true;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // -------------------------------------------------------------------------
    // Bound Timelock Governance
    // -------------------------------------------------------------------------
    function computeActionHash(
        AdminActionType actionType,
        address target,
        bytes32 role
    ) public view returns (bytes32) {
        return keccak256(abi.encode(actionType, target, role, address(this), block.chainid));
    }

    function scheduleAdminAction(
        AdminActionType actionType,
        address target,
        bytes32 role
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32 actionHash) {
        if (actionType != AdminActionType.SET_TIMELOCK_ENFORCEMENT && target == address(0)) {
            revert ZeroAddress();
        }
        actionHash = computeActionHash(actionType, target, role);
        if (queuedActions[actionHash].readyTimestamp != 0 && !queuedActions[actionHash].executed) {
            revert ActionAlreadyQueued(actionHash);
        }

        uint256 ready = block.timestamp + TIMELOCK_DELAY;
        queuedActions[actionHash] = QueuedAction({
            actionHash: actionHash,
            actionType: actionType,
            target: target,
            role: role,
            readyTimestamp: ready,
            executed: false
        });

        emit AdminActionScheduled(actionHash, uint8(actionType), target, role, ready);
        return actionHash;
    }

    function executeAdminAction(
        AdminActionType actionType,
        address target,
        bytes32 role
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 actionHash = computeActionHash(actionType, target, role);
        QueuedAction storage action = queuedActions[actionHash];
        if (action.readyTimestamp == 0) revert TimelockNotScheduled();
        if (action.executed) revert TimelockAlreadyExecuted();
        if (block.timestamp < action.readyTimestamp) revert TimelockPending(action.readyTimestamp);

        action.executed = true;

        if (actionType == AdminActionType.AUTHORIZE_VERIFIER) {
            isAuthorizedVerifier[target] = true;
            _roles[VERIFIER_ROLE][target] = true;
            emit VerifierAuthorized(target, msg.sender);
        } else if (actionType == AdminActionType.REVOKE_VERIFIER) {
            isAuthorizedVerifier[target] = false;
            _roles[VERIFIER_ROLE][target] = false;
            emit VerifierRevoked(target, msg.sender);
        } else if (actionType == AdminActionType.GRANT_ROLE) {
            _roles[role][target] = true;
            if (role == VERIFIER_ROLE) {
                isAuthorizedVerifier[target] = true;
                emit VerifierAuthorized(target, msg.sender);
            }
            emit RoleGranted(role, target, msg.sender);
        } else if (actionType == AdminActionType.REVOKE_ROLE) {
            _roles[role][target] = false;
            if (role == VERIFIER_ROLE) {
                isAuthorizedVerifier[target] = false;
                emit VerifierRevoked(target, msg.sender);
            }
            emit RoleRevoked(role, target, msg.sender);
        } else if (actionType == AdminActionType.TRANSFER_OWNERSHIP) {
            address oldOwner = owner;
            owner = target;
            if (oldOwner != target) {
                _roles[DEFAULT_ADMIN_ROLE][oldOwner] = false;
                _roles[VERIFIER_ROLE][oldOwner] = false;
                isAuthorizedVerifier[oldOwner] = false;
                emit RoleRevoked(DEFAULT_ADMIN_ROLE, oldOwner, msg.sender);
            }
            _roles[DEFAULT_ADMIN_ROLE][target] = true;
            emit OwnershipTransferred(oldOwner, target);
        } else if (actionType == AdminActionType.SET_TIMELOCK_ENFORCEMENT) {
            bool newEnforced = (target != address(0));
            timelockEnforced = newEnforced;
            emit TimelockEnforcementUpdated(newEnforced);
        }

        emit AdminActionExecuted(actionHash, uint8(actionType), target, role);
    }

    // Generic timelock for arbitrary hashes (e.g. oracle or parameter changes)
    function scheduleTimelock(bytes32 actionHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 ready = block.timestamp + TIMELOCK_DELAY;
        genericTimelocks[actionHash] = ready;
    }

    function executeTimelock(bytes32 actionHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 ready = genericTimelocks[actionHash];
        if (ready == 0) revert TimelockNotScheduled();
        if (block.timestamp < ready) revert TimelockPending(ready);
        delete genericTimelocks[actionHash];
    }

    // -------------------------------------------------------------------------
    // Anchoring & Credit Batch Minting
    // -------------------------------------------------------------------------
    /**
     * @notice Anchors a canonical verified project record hash to the blockchain.
     */
    function anchorRecord(
        bytes32 recordHash,
        string calldata projectCode,
        uint256 verifiedCarbonMilliTco2e
    ) external onlyAuthorizedVerifier nonReentrant {
        if (recordHash == bytes32(0)) revert InvalidRecordHash();
        if (verifiedCarbonMilliTco2e == 0) revert InvalidCarbonQuantity();
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

    struct BatchInput {
        string projectCode;
        uint256 vintageYear;
        string ecosystem;
        string methodology;
        string verificationBody;
        address recipient;
    }

    /**
     * @notice Mints an institutional credit batch with automatic 15% non-permanence risk buffer reserve.
     * Enforces strict consistency if an anchor already exists for this record hash.
     */
    function mintCreditBatch(
        bytes32 recordHash,
        uint256 totalCarbonMilli,
        BatchInput calldata input
    ) external onlyAuthorizedVerifier nonReentrant {
        if (recordHash == bytes32(0)) revert InvalidRecordHash();
        if (totalCarbonMilli == 0) revert InvalidCarbonQuantity();
        if (_creditBatches[recordHash].exists) revert RecordAlreadyAnchored(recordHash);

        // Conflict check against existing canonical anchor
        if (_anchors[recordHash].timestamp != 0) {
            RecordAnchor memory existing = _anchors[recordHash];
            if (existing.verifiedCarbonMilliTco2e != totalCarbonMilli) {
                revert AnchorQuantityMismatch(existing.verifiedCarbonMilliTco2e, totalCarbonMilli);
            }
            if (keccak256(bytes(existing.projectCode)) != keccak256(bytes(input.projectCode))) {
                revert AnchorProjectMismatch(existing.projectCode, input.projectCode);
            }
        } else {
            _anchors[recordHash] = RecordAnchor({
                recordHash: recordHash,
                projectCode: input.projectCode,
                verifiedCarbonMilliTco2e: totalCarbonMilli,
                blockNumber: block.number,
                timestamp: block.timestamp,
                verifier: msg.sender
            });
            _projectLatestAnchor[input.projectCode] = recordHash;
            emit RecordAnchored(recordHash, input.projectCode, totalCarbonMilli, block.timestamp, msg.sender);
        }

        // Calculate 15% permanence buffer reserve
        uint256 bufferPool = (totalCarbonMilli * BUFFER_POOL_PERCENT) / 100;
        uint256 circulating = totalCarbonMilli - bufferPool;

        address recipient = input.recipient == address(0) ? msg.sender : input.recipient;
        balanceOf[recordHash][recipient] += circulating;

        _creditBatches[recordHash] = CreditBatch({
            recordHash: recordHash,
            projectCode: input.projectCode,
            vintageYear: input.vintageYear,
            ecosystem: input.ecosystem,
            methodology: input.methodology,
            verificationBody: input.verificationBody,
            totalMintedMilli: totalCarbonMilli,
            circulatingMilli: circulating,
            bufferPoolMilli: bufferPool,
            retiredMilli: 0,
            exists: true
        });

        emit CreditBatchMinted(
            recordHash,
            input.projectCode,
            totalCarbonMilli,
            circulating,
            bufferPool,
            input.vintageYear,
            recipient
        );
        emit CreditsTransferred(recordHash, address(0), recipient, circulating);
    }

    // -------------------------------------------------------------------------
    // Credit Transfer & Ownership-Bound Retirement
    // -------------------------------------------------------------------------
    /**
     * @notice Transfers ownership of carbon credits within a batch.
     */
    function transferCredits(
        bytes32 recordHash,
        address to,
        uint256 amountMilliTco2e
    ) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[recordHash][msg.sender] < amountMilliTco2e) {
            revert InsufficientBalance(amountMilliTco2e, balanceOf[recordHash][msg.sender]);
        }

        balanceOf[recordHash][msg.sender] -= amountMilliTco2e;
        balanceOf[recordHash][to] += amountMilliTco2e;
        emit CreditsTransferred(recordHash, msg.sender, to, amountMilliTco2e);
    }

    /**
     * @notice Irreversibly burns/retires credits on behalf of a named beneficiary.
     * Strictly ownership-bound: caller must possess sufficient balance in balanceOf[recordHash][msg.sender].
     */
    function retireCredits(
        bytes32 recordHash,
        uint256 amountMilliTco2e,
        string calldata beneficiary,
        string calldata retirementReason
    ) external nonReentrant returns (bytes32 certificateId) {
        CreditBatch storage batch = _creditBatches[recordHash];
        if (!batch.exists) revert BatchNotFound(recordHash);

        // Strict ownership check: caller cannot burn credits belonging to other wallets
        if (balanceOf[recordHash][msg.sender] < amountMilliTco2e) {
            revert InsufficientBalance(amountMilliTco2e, balanceOf[recordHash][msg.sender]);
        }

        balanceOf[recordHash][msg.sender] -= amountMilliTco2e;
        batch.circulatingMilli -= amountMilliTco2e;
        batch.retiredMilli += amountMilliTco2e;
        _retirementNonce++;

        certificateId = keccak256(
            abi.encodePacked(
                recordHash,
                msg.sender,
                beneficiary,
                block.timestamp,
                _retirementNonce
            )
        );

        _certificates[certificateId] = RetirementCertificate({
            certificateId: certificateId,
            recordHash: recordHash,
            retiree: msg.sender,
            beneficiary: beneficiary,
            retirementReason: retirementReason,
            amountMilliTco2e: amountMilliTco2e,
            timestamp: block.timestamp
        });

        emit CreditsRetired(
            certificateId,
            recordHash,
            msg.sender,
            beneficiary,
            amountMilliTco2e,
            retirementReason,
            block.timestamp
        );

        return certificateId;
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------
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

    function getCreditBatch(bytes32 recordHash)
        external
        view
        returns (
            string memory projectCode,
            uint256 vintageYear,
            string memory ecosystem,
            string memory methodology,
            string memory verificationBody,
            uint256 totalMintedMilli,
            uint256 circulatingMilli,
            uint256 bufferPoolMilli,
            uint256 retiredMilli
        )
    {
        CreditBatch memory b = _creditBatches[recordHash];
        if (!b.exists) revert BatchNotFound(recordHash);
        return (
            b.projectCode,
            b.vintageYear,
            b.ecosystem,
            b.methodology,
            b.verificationBody,
            b.totalMintedMilli,
            b.circulatingMilli,
            b.bufferPoolMilli,
            b.retiredMilli
        );
    }

    function getRetirementCertificate(bytes32 certificateId)
        external
        view
        returns (
            bytes32 recordHash,
            address retiree,
            string memory beneficiary,
            string memory retirementReason,
            uint256 amountMilliTco2e,
            uint256 timestamp
        )
    {
        RetirementCertificate memory c = _certificates[certificateId];
        return (
            c.recordHash,
            c.retiree,
            c.beneficiary,
            c.retirementReason,
            c.amountMilliTco2e,
            c.timestamp
        );
    }

    function getLatestAnchor(string calldata projectCode) external view returns (bytes32) {
        return _projectLatestAnchor[projectCode];
    }
}
