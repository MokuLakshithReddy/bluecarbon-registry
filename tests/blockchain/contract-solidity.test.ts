import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
// @ts-expect-error - solc is a CJS compiler module
import solc from "solc";
import {
  BLUE_CARBON_REGISTRY_ABI,
  toMilliTco2e,
  fromMilliTco2e,
} from "../../src/lib/blockchain.server.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTRACT_SOURCE_PATH = path.resolve(__dirname, "../../contracts/BlueCarbonRegistry.sol");

test("Contract Compilation: BlueCarbonRegistry.sol compiles cleanly with solc compiler and generates bytecode", () => {
  assert.ok(fs.existsSync(CONTRACT_SOURCE_PATH), "Contract source file must exist");
  const source = fs.readFileSync(CONTRACT_SOURCE_PATH, "utf-8");

  const input = {
    language: "Solidity",
    sources: {
      "BlueCarbonRegistry.sol": {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  // Ensure no compilation errors
  if (output.errors) {
    const fatalErrors = output.errors.filter((e: { severity: string }) => e.severity === "error");
    assert.strictEqual(
      fatalErrors.length,
      0,
      `Solidity compilation failed with errors: ${JSON.stringify(fatalErrors)}`,
    );
  }

  const contract = output.contracts?.["BlueCarbonRegistry.sol"]?.["BlueCarbonRegistry"];
  assert.ok(contract, "Compiled contract artifact BlueCarbonRegistry must exist");
  assert.ok(contract.evm?.bytecode?.object, "Must generate EVM bytecode");
  assert.ok(
    contract.evm.bytecode.object.length > 100,
    "Bytecode must be non-trivial compiled EVM binary",
  );

  // Validate that generated ABI contains critical registry functions
  const compiledAbi = contract.abi as Array<{ name?: string; type: string }>;
  const functionNames = compiledAbi
    .filter((item) => item.type === "function")
    .map((item) => item.name);
  assert.ok(functionNames.includes("anchorRecord"), "Compiled ABI must have anchorRecord");
  assert.ok(
    functionNames.includes("authorizeVerifier"),
    "Compiled ABI must have authorizeVerifier",
  );
  assert.ok(functionNames.includes("revokeVerifier"), "Compiled ABI must have revokeVerifier");
  assert.ok(functionNames.includes("verifyRecord"), "Compiled ABI must have verifyRecord");
  assert.ok(functionNames.includes("getLatestAnchor"), "Compiled ABI must have getLatestAnchor");

  // Validate that event RecordAnchored is present in compiled ABI
  const eventNames = compiledAbi.filter((item) => item.type === "event").map((item) => item.name);
  assert.ok(
    eventNames.includes("RecordAnchored"),
    "Compiled ABI must include RecordAnchored event",
  );
});

test("Contract Source: BlueCarbonRegistry.sol contains RBAC and fixed-point precision", () => {
  assert.ok(fs.existsSync(CONTRACT_SOURCE_PATH), "Contract source file must exist");
  const source = fs.readFileSync(CONTRACT_SOURCE_PATH, "utf-8");

  // Verify Access Control structures
  assert.ok(source.includes("address public owner;"), "Must declare owner");
  assert.ok(
    source.includes("mapping(address => bool) public isAuthorizedVerifier;"),
    "Must declare authorized verifiers mapping",
  );
  assert.ok(source.includes("modifier onlyAuthorizedVerifier()"), "Must define verifier modifier");
  assert.ok(source.includes("modifier onlyOwner()"), "Must define owner modifier");
  assert.ok(source.includes("function authorizeVerifier("), "Must implement authorizeVerifier");
  assert.ok(source.includes("function revokeVerifier("), "Must implement revokeVerifier");
  assert.ok(source.includes("function transferOwnership("), "Must implement transferOwnership");

  // Verify precision scaling constants
  assert.ok(
    source.includes("uint8 public constant CARBON_DECIMALS = 3;"),
    "Must define CARBON_DECIMALS = 3",
  );
  assert.ok(
    source.includes("uint256 public constant CARBON_SCALE_FACTOR = 1000;"),
    "Must define CARBON_SCALE_FACTOR = 1000",
  );

  // Verify custom errors
  assert.ok(
    source.includes("error UnauthorizedVerifier(address caller);"),
    "Must define custom error UnauthorizedVerifier",
  );
  assert.ok(source.includes("error OnlyOwner();"), "Must define custom error OnlyOwner");
  assert.ok(source.includes("error RecordAlreadyAnchored(bytes32 recordHash);"));
});

test("Contract ABI: Interface encodes and decodes anchorRecord and events with full precision", () => {
  const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);

  const sampleRecordHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const projectCode = "BC-MNG-0001";
  const originalCarbonTco2e = 520.65;
  const milliTco2e = toMilliTco2e(originalCarbonTco2e);

  // 1. Encode anchorRecord calldata
  const calldata = iface.encodeFunctionData("anchorRecord", [
    sampleRecordHash,
    projectCode,
    milliTco2e,
  ]);
  assert.ok(calldata.startsWith("0x"));

  // 2. Decode calldata and verify precision integrity
  const decoded = iface.decodeFunctionData("anchorRecord", calldata);
  assert.strictEqual(decoded[0], sampleRecordHash);
  assert.strictEqual(decoded[1], projectCode);
  assert.strictEqual(decoded[2], 520650n);
  assert.strictEqual(fromMilliTco2e(decoded[2]), 520.65);

  // 3. Encode and parse RecordAnchored event
  const eventFragment = iface.getEvent("RecordAnchored");
  assert.ok(eventFragment != null);

  const testVerifierAddress = "0x2222222222222222222222222222222222222222";
  const testTimestamp = 1770000000n;

  const encodedLog = iface.encodeEventLog(eventFragment, [
    sampleRecordHash,
    projectCode,
    milliTco2e,
    testTimestamp,
    testVerifierAddress,
  ]);

  const parsedLog = iface.parseLog({
    topics: [...encodedLog.topics],
    data: encodedLog.data,
  });

  assert.ok(parsedLog != null);
  assert.strictEqual(parsedLog.name, "RecordAnchored");
  assert.strictEqual(parsedLog.args["recordHash"], sampleRecordHash);
  assert.strictEqual(parsedLog.args["projectCode"], projectCode);
  assert.strictEqual(parsedLog.args["verifiedCarbonMilliTco2e"], 520650n);
  assert.strictEqual(fromMilliTco2e(parsedLog.args["verifiedCarbonMilliTco2e"]), 520.65);
  assert.strictEqual(parsedLog.args["verifier"].toLowerCase(), testVerifierAddress.toLowerCase());
});

test("Contract RBAC Simulation: Authorized vs Unauthorized verifier behavior", () => {
  const authorizedVerifiers = new Set<string>();
  const anchoredRecords = new Map<
    string,
    { projectCode: string; milliTco2e: bigint; timestamp: bigint; verifier: string }
  >();
  let owner = "0x1111111111111111111111111111111111111111".toLowerCase();
  authorizedVerifiers.add(owner); // Deployer is auto-authorized

  function anchorRecord(
    caller: string,
    recordHash: string,
    projectCode: string,
    milliTco2e: bigint,
  ) {
    const norm = caller.toLowerCase();
    if (!authorizedVerifiers.has(norm) && norm !== owner) {
      throw new Error(`UnauthorizedVerifier: caller ${caller} is not an authorized verifier`);
    }
    if (recordHash === ethers.ZeroHash || !recordHash || recordHash === "0x0") {
      throw new Error("InvalidRecordHash: recordHash cannot be zero");
    }
    if (anchoredRecords.has(recordHash)) {
      throw new Error(`RecordAlreadyAnchored: recordHash ${recordHash} has already been anchored`);
    }
    anchoredRecords.set(recordHash, {
      projectCode,
      milliTco2e,
      timestamp: BigInt(Date.now()),
      verifier: norm,
    });
    return true;
  }

  function authorizeVerifier(caller: string, newVerifier: string) {
    if (caller.toLowerCase() !== owner) {
      throw new Error("OnlyOwner: caller is not contract owner");
    }
    if (newVerifier === ethers.ZeroAddress) {
      throw new Error("ZeroAddress: cannot authorize zero address");
    }
    authorizedVerifiers.add(newVerifier.toLowerCase());
  }

  function revokeVerifier(caller: string, verifierToRevoke: string) {
    if (caller.toLowerCase() !== owner) {
      throw new Error("OnlyOwner: caller is not contract owner");
    }
    if (verifierToRevoke === ethers.ZeroAddress) {
      throw new Error("ZeroAddress: cannot revoke zero address");
    }
    authorizedVerifiers.delete(verifierToRevoke.toLowerCase());
  }

  function transferOwnership(caller: string, newOwner: string) {
    if (caller.toLowerCase() !== owner) {
      throw new Error("OnlyOwner: caller is not contract owner");
    }
    if (newOwner === ethers.ZeroAddress) {
      throw new Error("ZeroAddress: cannot transfer to zero address");
    }
    owner = newOwner.toLowerCase();
  }

  const authorizedVerifier = "0x2222222222222222222222222222222222222222";
  const unauthorizedAttacker = "0x9999999999999999999999999999999999999999";
  const sampleHash1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const sampleHash2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // 1. Unauthorized caller fails to anchor
  assert.throws(
    () => anchorRecord(unauthorizedAttacker, sampleHash1, "BC-001", 1000n),
    /UnauthorizedVerifier/,
    "Unauthorized address must be rejected",
  );

  // 2. Non-owner cannot authorize verifiers
  assert.throws(
    () => authorizeVerifier(unauthorizedAttacker, authorizedVerifier),
    /OnlyOwner/,
    "Non-owner cannot grant verifier rights",
  );

  // 3. Owner authorizes verifier -> anchoring succeeds
  authorizeVerifier(owner, authorizedVerifier);
  assert.strictEqual(anchorRecord(authorizedVerifier, sampleHash1, "BC-001", 1000n), true);

  // 4. Duplicate anchoring of the same recordHash MUST REVERT
  assert.throws(
    () => anchorRecord(authorizedVerifier, sampleHash1, "BC-001", 1000n),
    /RecordAlreadyAnchored/,
    "Re-anchoring the same recordHash must revert immediately",
  );

  // 5. Zero recordHash is rejected
  assert.throws(
    () => anchorRecord(authorizedVerifier, ethers.ZeroHash, "BC-001", 1000n),
    /InvalidRecordHash/,
    "Zero bytes32 recordHash must revert",
  );

  // 6. Owner revokes verifier -> subsequent anchoring now fails
  revokeVerifier(owner, authorizedVerifier);
  assert.throws(
    () => anchorRecord(authorizedVerifier, sampleHash2, "BC-002", 2000n),
    /UnauthorizedVerifier/,
    "Revoked verifier must be blocked from anchoring",
  );

  // 7. Ownership transfer enables new governor to manage verifiers
  const oldOwner = owner;
  const newGovernor = "0x3333333333333333333333333333333333333333";
  transferOwnership(oldOwner, newGovernor);
  assert.throws(
    () => authorizeVerifier(oldOwner, authorizedVerifier),
    /OnlyOwner/,
    "Old owner loses verifier authorization privileges",
  );

  // New owner re-authorizes verifier -> anchoring succeeds again
  authorizeVerifier(newGovernor, authorizedVerifier);
  assert.strictEqual(anchorRecord(authorizedVerifier, sampleHash2, "BC-002", 2000n), true);
});
