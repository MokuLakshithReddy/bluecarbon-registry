// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlueCarbonRegistry
 * @dev On-chain anchor contract for verified blue-carbon restoration records.
 * Only the cryptographic digest (recordHash) and verification summary are stored on-chain.
 */
contract BlueCarbonRegistry {
    struct RecordAnchor {
        bytes32 recordHash;
        string projectCode;
        uint256 verifiedTco2e;
        uint256 blockNumber;
        uint256 timestamp;
        address verifier;
    }

    mapping(bytes32 => RecordAnchor) private _anchors;
    mapping(string => bytes32) private _projectLatestAnchor;

    event RecordAnchored(
        bytes32 indexed recordHash,
        string indexed projectCode,
        uint256 verifiedTco2e,
        uint256 timestamp,
        address indexed verifier
    );

    error RecordAlreadyAnchored(bytes32 recordHash);
    error InvalidRecordHash();

    /**
     * @notice Anchors a canonical verified project record hash to the blockchain.
     * @param recordHash The SHA-256 canonical hash of the verified project record.
     * @param projectCode Unique registry project code (e.g., "BCR-MANG-0001").
     * @param verifiedTco2e Confirmed metric tonnes of CO2 equivalent verified.
     */
    function anchorRecord(
        bytes32 recordHash,
        string calldata projectCode,
        uint256 verifiedTco2e
    ) external {
        if (recordHash == bytes32(0)) revert InvalidRecordHash();
        if (_anchors[recordHash].timestamp != 0) revert RecordAlreadyAnchored(recordHash);

        _anchors[recordHash] = RecordAnchor({
            recordHash: recordHash,
            projectCode: projectCode,
            verifiedTco2e: verifiedTco2e,
            blockNumber: block.number,
            timestamp: block.timestamp,
            verifier: msg.sender
        });

        _projectLatestAnchor[projectCode] = recordHash;

        emit RecordAnchored(recordHash, projectCode, verifiedTco2e, block.timestamp, msg.sender);
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
            uint256 verifiedTco2e,
            uint256 blockNumber,
            uint256 timestamp,
            address verifier
        )
    {
        RecordAnchor memory r = _anchors[recordHash];
        return (
            r.timestamp > 0,
            r.projectCode,
            r.verifiedTco2e,
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
