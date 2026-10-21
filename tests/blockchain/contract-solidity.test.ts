import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  BLUE_CARBON_REGISTRY_ABI,
  toMilliTco2e,
  fromMilliTco2e,
} from "../../src/lib/blockchain.server.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTRACT_SOURCE_PATH = path.resolve(__dirname, "../../contracts/BlueCarbonRegistry.sol");

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
  const owner = "0x1111111111111111111111111111111111111111".toLowerCase();
  authorizedVerifiers.add(owner); // Deployer is auto-authorized

  function anchorRecordSimulated(caller: string) {
    const norm = caller.toLowerCase();
    if (!authorizedVerifiers.has(norm) && norm !== owner) {
      throw new Error(`UnauthorizedVerifier: caller ${caller} is not an authorized verifier`);
    }
    return true;
  }

  function authorizeVerifierSimulated(caller: string, newVerifier: string) {
    if (caller.toLowerCase() !== owner) {
      throw new Error("OnlyOwner: caller is not contract owner");
    }
    authorizedVerifiers.add(newVerifier.toLowerCase());
  }

  function revokeVerifierSimulated(caller: string, verifierToRevoke: string) {
    if (caller.toLowerCase() !== owner) {
      throw new Error("OnlyOwner: caller is not contract owner");
    }
    authorizedVerifiers.delete(verifierToRevoke.toLowerCase());
  }

  const authorizedVerifier = "0x2222222222222222222222222222222222222222";
  const unauthorizedAttacker = "0x9999999999999999999999999999999999999999";

  // 1. Unauthorized caller fails to anchor
  assert.throws(
    () => anchorRecordSimulated(unauthorizedAttacker),
    /UnauthorizedVerifier/,
    "Unauthorized address must be rejected",
  );

  // 2. Non-owner cannot authorize verifiers
  assert.throws(
    () => authorizeVerifierSimulated(unauthorizedAttacker, authorizedVerifier),
    /OnlyOwner/,
    "Non-owner cannot grant verifier rights",
  );

  // 3. Owner authorizes verifier -> anchoring succeeds
  authorizeVerifierSimulated(owner, authorizedVerifier);
  assert.strictEqual(anchorRecordSimulated(authorizedVerifier), true);

  // 4. Owner revokes verifier -> anchoring now fails
  revokeVerifierSimulated(owner, authorizedVerifier);
  assert.throws(
    () => anchorRecordSimulated(authorizedVerifier),
    /UnauthorizedVerifier/,
    "Revoked verifier must be blocked from anchoring",
  );
});
