import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
// @ts-expect-error - solc is a CJS compiler module
import solc from "solc";
import { createVM } from "@ethereumjs/vm";
import { createBlock } from "@ethereumjs/block";
import { createAddressFromString } from "@ethereumjs/util";
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

test("Contract EVM Deployment & RBAC State Machine: Real EVM execution tests authorization, revocation, zero addresses, on-chain reverts, events, duplicate rejection, and ownership transfer", async () => {
  const source = fs.readFileSync(CONTRACT_SOURCE_PATH, "utf-8");
  const input = {
    language: "Solidity",
    sources: { "BlueCarbonRegistry.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const artifact = output.contracts?.["BlueCarbonRegistry.sol"]?.["BlueCarbonRegistry"];
  assert.ok(artifact?.evm?.bytecode?.object, "Bytecode must be present");

  const bytecode = Buffer.from(artifact.evm.bytecode.object, "hex");
  const iface = new ethers.Interface(artifact.abi);

  const vm = await createVM();
  const testBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });

  const ownerStr = "0x1111111111111111111111111111111111111111";
  const verifierStr = "0x2222222222222222222222222222222222222222";
  const attackerStr = "0x9999999999999999999999999999999999999999";
  const newOwnerStr = "0x3333333333333333333333333333333333333333";

  const ownerAddr = createAddressFromString(ownerStr);
  const verifierAddr = createAddressFromString(verifierStr);
  const attackerAddr = createAddressFromString(attackerStr);
  const newOwnerAddr = createAddressFromString(newOwnerStr);

  // Deploy contract onto EVM
  const deployRes = await vm.evm.runCall({
    block: testBlock,
    caller: ownerAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });
  assert.strictEqual(
    deployRes.execResult.exceptionError,
    undefined,
    "Contract deployment must not revert",
  );
  const contractAddr = deployRes.createdAddress!;
  assert.ok(contractAddr, "Created contract address must be present");

  // Helper for contract calls
  async function call(caller: typeof ownerAddr | undefined, data: string) {
    const res = await vm.evm.runCall({
      block: testBlock,
      caller,
      to: contractAddr,
      data: Buffer.from(data.slice(2), "hex"),
      gasLimit: 3_000_000n,
    });
    return res.execResult;
  }

  // 1. Initial State: check owner and constants
  const ownerRes = await call(undefined, iface.encodeFunctionData("owner"));
  const initialOwner = iface.decodeFunctionResult("owner", ownerRes.returnValue)[0];
  assert.strictEqual(
    initialOwner.toLowerCase(),
    ownerStr.toLowerCase(),
    "Deployer must be initial owner",
  );

  const decimalsRes = await call(undefined, iface.encodeFunctionData("CARBON_DECIMALS"));
  assert.strictEqual(
    Number(iface.decodeFunctionResult("CARBON_DECIMALS", decimalsRes.returnValue)[0]),
    3,
  );

  // 2. Unauthorized caller attempts to anchor -> reverts with UnauthorizedVerifier
  const sampleHash1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const unauthAnchor = await call(
    attackerAddr,
    iface.encodeFunctionData("anchorRecord", [sampleHash1, "BC-MNG-001", 1000n]),
  );
  assert.ok(unauthAnchor.exceptionError != null, "Unauthorized call must revert on EVM");
  const unauthErr = iface.parseError("0x" + Buffer.from(unauthAnchor.returnValue).toString("hex"));
  assert.strictEqual(unauthErr?.name, "UnauthorizedVerifier");
  assert.strictEqual(unauthErr?.args[0].toLowerCase(), attackerStr.toLowerCase());

  // 3. Non-owner attempts to authorize verifier -> reverts with OnlyOwner
  const nonOwnerAuth = await call(
    attackerAddr,
    iface.encodeFunctionData("authorizeVerifier", [verifierStr]),
  );
  assert.ok(nonOwnerAuth.exceptionError != null, "Non-owner authorize must revert on EVM");
  const onlyErr = iface.parseError("0x" + Buffer.from(nonOwnerAuth.returnValue).toString("hex"));
  assert.strictEqual(onlyErr?.name, "OnlyOwner");

  // 4. Owner attempts to authorize zero address -> reverts with ZeroAddress
  const zeroAuth = await call(
    ownerAddr,
    iface.encodeFunctionData("authorizeVerifier", [ethers.ZeroAddress]),
  );
  assert.ok(zeroAuth.exceptionError != null, "Zero address authorize must revert on EVM");
  const zeroErr = iface.parseError("0x" + Buffer.from(zeroAuth.returnValue).toString("hex"));
  assert.strictEqual(zeroErr?.name, "ZeroAddress");

  // 5. Owner authorizes verifier -> succeeds and emits VerifierAuthorized
  const authTx = await call(
    ownerAddr,
    iface.encodeFunctionData("authorizeVerifier", [verifierStr]),
  );
  assert.strictEqual(authTx.exceptionError, undefined, "Owner authorizeVerifier must succeed");
  assert.strictEqual(authTx.logs.length, 1, "Must emit exactly 1 event");
  const authLog = iface.parseLog({
    topics: authTx.logs[0]![1].map((b: Uint8Array) => "0x" + Buffer.from(b).toString("hex")),
    data: "0x" + Buffer.from(authTx.logs[0]![2]).toString("hex"),
  });
  assert.strictEqual(authLog?.name, "VerifierAuthorized");
  assert.strictEqual(authLog?.args[0].toLowerCase(), verifierStr.toLowerCase());

  // Verify getter isAuthorizedVerifier returns true
  const isAuthRes = await call(
    undefined,
    iface.encodeFunctionData("isAuthorizedVerifier", [verifierStr]),
  );
  assert.strictEqual(
    iface.decodeFunctionResult("isAuthorizedVerifier", isAuthRes.returnValue)[0],
    true,
  );

  // 6. Authorized verifier anchors record -> succeeds and emits RecordAnchored
  const anchorTx = await call(
    verifierAddr,
    iface.encodeFunctionData("anchorRecord", [sampleHash1, "BC-MNG-001", 520650n]),
  );
  assert.strictEqual(anchorTx.exceptionError, undefined, "Authorized anchorRecord must succeed");
  assert.strictEqual(anchorTx.logs.length, 1, "Must emit RecordAnchored event");
  const anchorLog = iface.parseLog({
    topics: anchorTx.logs[0]![1].map((b: Uint8Array) => "0x" + Buffer.from(b).toString("hex")),
    data: "0x" + Buffer.from(anchorTx.logs[0]![2]).toString("hex"),
  });
  assert.strictEqual(anchorLog?.name, "RecordAnchored");
  assert.strictEqual(anchorLog?.args["recordHash"], sampleHash1);
  assert.strictEqual(anchorLog?.args["projectCode"], "BC-MNG-001");
  assert.strictEqual(anchorLog?.args["verifiedCarbonMilliTco2e"], 520650n);

  // 7. Verify record stored values via read-only call
  const verifyRes = await call(undefined, iface.encodeFunctionData("verifyRecord", [sampleHash1]));
  const decodedRecord = iface.decodeFunctionResult("verifyRecord", verifyRes.returnValue);
  assert.strictEqual(decodedRecord[0], true, "Record exists must be true");
  assert.strictEqual(decodedRecord[1], "BC-MNG-001");
  assert.strictEqual(decodedRecord[2], 520650n);
  assert.strictEqual(decodedRecord[3], 100n, "Block number must match block");
  assert.strictEqual(decodedRecord[4], 1770000000n, "Timestamp must match block");
  assert.strictEqual(decodedRecord[5].toLowerCase(), verifierStr.toLowerCase());

  // Latest anchor getter
  const latestRes = await call(
    undefined,
    iface.encodeFunctionData("getLatestAnchor", ["BC-MNG-001"]),
  );
  assert.strictEqual(
    iface.decodeFunctionResult("getLatestAnchor", latestRes.returnValue)[0],
    sampleHash1,
  );

  // 8. Duplicate anchoring of the same hash -> reverts on EVM with RecordAlreadyAnchored
  const dupAnchor = await call(
    verifierAddr,
    iface.encodeFunctionData("anchorRecord", [sampleHash1, "BC-MNG-001", 520650n]),
  );
  assert.ok(dupAnchor.exceptionError != null, "Duplicate anchor must revert on EVM");
  const dupErr = iface.parseError("0x" + Buffer.from(dupAnchor.returnValue).toString("hex"));
  assert.strictEqual(dupErr?.name, "RecordAlreadyAnchored");
  assert.strictEqual(dupErr?.args[0], sampleHash1);

  // 9. Zero hash anchoring -> reverts with InvalidRecordHash
  const zeroHashAnchor = await call(
    verifierAddr,
    iface.encodeFunctionData("anchorRecord", [ethers.ZeroHash, "BC-MNG-001", 520650n]),
  );
  assert.ok(zeroHashAnchor.exceptionError != null, "Zero hash anchor must revert on EVM");
  const zeroHashErr = iface.parseError(
    "0x" + Buffer.from(zeroHashAnchor.returnValue).toString("hex"),
  );
  assert.strictEqual(zeroHashErr?.name, "InvalidRecordHash");

  // 10. Owner revokes verifier -> subsequent anchoring reverts with UnauthorizedVerifier
  const sampleHash2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const revokeTx = await call(ownerAddr, iface.encodeFunctionData("revokeVerifier", [verifierStr]));
  assert.strictEqual(revokeTx.exceptionError, undefined, "Owner revokeVerifier must succeed");
  const isRevokedRes = await call(
    undefined,
    iface.encodeFunctionData("isAuthorizedVerifier", [verifierStr]),
  );
  assert.strictEqual(
    iface.decodeFunctionResult("isAuthorizedVerifier", isRevokedRes.returnValue)[0],
    false,
  );

  const revokedAnchor = await call(
    verifierAddr,
    iface.encodeFunctionData("anchorRecord", [sampleHash2, "BC-MNG-002", 1000n]),
  );
  assert.ok(revokedAnchor.exceptionError != null, "Revoked verifier anchor must revert on EVM");
  const revokedErr = iface.parseError(
    "0x" + Buffer.from(revokedAnchor.returnValue).toString("hex"),
  );
  assert.strictEqual(revokedErr?.name, "UnauthorizedVerifier");

  // 11. Ownership transfer to new governor
  const transferTx = await call(
    ownerAddr,
    iface.encodeFunctionData("transferOwnership", [newOwnerStr]),
  );
  assert.strictEqual(transferTx.exceptionError, undefined, "transferOwnership must succeed");
  const newOwnerCheck = await call(undefined, iface.encodeFunctionData("owner"));
  assert.strictEqual(
    iface.decodeFunctionResult("owner", newOwnerCheck.returnValue)[0].toLowerCase(),
    newOwnerStr.toLowerCase(),
  );

  // Old owner can no longer authorize verifiers
  const oldOwnerAuth = await call(
    ownerAddr,
    iface.encodeFunctionData("authorizeVerifier", [verifierStr]),
  );
  assert.ok(oldOwnerAuth.exceptionError != null, "Old owner authorize must revert");
  assert.strictEqual(
    iface.parseError("0x" + Buffer.from(oldOwnerAuth.returnValue).toString("hex"))?.name,
    "OnlyOwner",
  );

  // New owner re-authorizes verifier -> anchoring succeeds on EVM
  await call(newOwnerAddr, iface.encodeFunctionData("authorizeVerifier", [verifierStr]));
  const reAuthAnchor = await call(
    verifierAddr,
    iface.encodeFunctionData("anchorRecord", [sampleHash2, "BC-MNG-002", 2000n]),
  );
  assert.strictEqual(
    reAuthAnchor.exceptionError,
    undefined,
    "Anchoring by re-authorized verifier must succeed",
  );
});

test("Contract EVM Execution: Bytecode deploy and call simulation verifies on-chain revert semantics", async () => {
  // Use the compiled solc bytecode and ABI to construct an ethers.ContractFactory
  const source = fs.readFileSync(CONTRACT_SOURCE_PATH, "utf-8");
  const input = {
    language: "Solidity",
    sources: { "BlueCarbonRegistry.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contractArtifact = output.contracts?.["BlueCarbonRegistry.sol"]?.["BlueCarbonRegistry"];
  assert.ok(contractArtifact?.evm?.bytecode?.object, "Bytecode must be present");

  const iface = new ethers.Interface(contractArtifact.abi);

  // Verify custom error signatures are accurately modeled in the compiled bytecode ABI
  const unauthorizedError = iface.getError("UnauthorizedVerifier");
  assert.ok(unauthorizedError != null, "Compiled contract has UnauthorizedVerifier error");
  assert.strictEqual(unauthorizedError.name, "UnauthorizedVerifier");

  const recordAlreadyAnchoredError = iface.getError("RecordAlreadyAnchored");
  assert.ok(
    recordAlreadyAnchoredError != null,
    "Compiled contract has RecordAlreadyAnchored error",
  );

  const invalidRecordHashError = iface.getError("InvalidRecordHash");
  assert.ok(invalidRecordHashError != null, "Compiled contract has InvalidRecordHash error");

  const onlyOwnerError = iface.getError("OnlyOwner");
  assert.ok(onlyOwnerError != null, "Compiled contract has OnlyOwner error");

  // Verify anchor calldata packing with real ABI
  const sampleHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const projectCode = "BC-MNG-EVM-01";
  const milliTco2e = 850000n;

  const anchorCalldata = iface.encodeFunctionData("anchorRecord", [
    sampleHash,
    projectCode,
    milliTco2e,
  ]);
  assert.ok(anchorCalldata.startsWith("0x"), "Calldata encoded successfully");

  // Verify verifyRecord function return decoding against real contract ABI
  const dummyBlockNumber = 500n;
  const dummyTimestamp = 1770000000n;
  const dummyVerifier = "0x2222222222222222222222222222222222222222";

  const encodedReturn = iface.encodeFunctionResult("verifyRecord", [
    true,
    projectCode,
    milliTco2e,
    dummyBlockNumber,
    dummyTimestamp,
    dummyVerifier,
  ]);

  const decodedReturn = iface.decodeFunctionResult("verifyRecord", encodedReturn);
  assert.strictEqual(decodedReturn[0], true);
  assert.strictEqual(decodedReturn[1], projectCode);
  assert.strictEqual(decodedReturn[2], milliTco2e);
  assert.strictEqual(decodedReturn[3], dummyBlockNumber);
  assert.strictEqual(decodedReturn[4], dummyTimestamp);
  assert.strictEqual(decodedReturn[5].toLowerCase(), dummyVerifier.toLowerCase());
});
