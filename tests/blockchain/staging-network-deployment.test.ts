import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ethers } from "ethers";
import {
  createRealEvmProvider,
  validateEVMNetworkAndContract,
  BLUE_CARBON_REGISTRY_ABI,
  SIMULATION_DUMMY_KEY,
  isApprovedLoopbackHost,
  isLoopbackRpcUrl,
  assertSafeStagingConfiguration,
  type AnchorPayload,
  type EvmConfig,
} from "../../src/lib/blockchain.server.ts";

const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);

// Test fixtures for simulation wire protocol
const STAGING_CHAIN_ID = 11155111; // Ethereum Sepolia Staging Testnet
const STAGING_CONTRACT_ADDRESS = "0x7777777777777777777777777777777777777777";
const SIMULATION_DEPLOYER_ADDRESS = new ethers.Wallet(SIMULATION_DUMMY_KEY).address;

export { assertSafeStagingConfiguration };

interface StagingRpcServerOptions {
  receiptStatus?: "0x1" | "0x0";
  blockConfirmations?: number;
  initialBlockNumber?: number;
}

/**
 * Spawns an HTTP JSON-RPC 2.0 wire-protocol server mimicking a live staging node (e.g. Sepolia / Amoy).
 * Handles batching, eth_getBlockByNumber, eth_sendRawTransaction, eth_getTransactionReceipt, and eth_call.
 */
function createStagingRpcWireServer(opts: StagingRpcServerOptions = {}) {
  const receiptStatus = opts.receiptStatus ?? "0x1";
  const confirmations = opts.blockConfirmations ?? 2;
  const currentBlockNumber = opts.initialBlockNumber ?? 5890123;
  let lastReceivedRawTx: string | null = null;
  let simulatedTxHash = ethers.keccak256(ethers.toUtf8Bytes(`staging-tx-${Date.now()}`));

  let lastRecordHash: string = ethers.keccak256(
    ethers.toUtf8Bytes("REF-SUNDARBANS-LOTHIAN-2024-V1"),
  );

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const json = JSON.parse(body);

        const handleMethod = (method: string, params: unknown[]): unknown => {
          switch (method) {
            case "eth_chainId":
              return "0x" + STAGING_CHAIN_ID.toString(16);
            case "net_version":
              return String(STAGING_CHAIN_ID);
            case "eth_blockNumber":
              return "0x" + (currentBlockNumber + confirmations).toString(16);
            case "eth_getBlockByNumber":
              return {
                number: "0x" + currentBlockNumber.toString(16),
                hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
                nonce: "0x0000000000000000",
                sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
                logsBloom: "0x" + "0".repeat(512),
                transactionsRoot:
                  "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                stateRoot: "0xd5855eb95b30d52503254924c13061719ad91981d9b52a5c040d980836519177",
                receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                miner: "0x0000000000000000000000000000000000000000",
                difficulty: "0x1",
                totalDifficulty: "0x1",
                extraData: "0x",
                size: "0x100",
                gasLimit: "0x1c9c380",
                gasUsed: "0x5208",
                timestamp: "0x65000000",
                transactions: [],
                uncles: [],
                baseFeePerGas: "0x3b9aca00",
              };
            case "eth_getCode":
              return "0x608060405234801561001057600080fd5b50610120806100206000396000f3fe608060405234801561001057600080fd5b50";
            case "eth_getTransactionCount":
              return "0x10";
            case "eth_gasPrice":
              return "0x3b9aca00";
            case "eth_estimateGas":
              return "0x249f0";
            case "eth_feeHistory":
              return {
                oldestBlock: "0x100",
                reward: [["0x3b9aca00"]],
                baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
                gasUsedRatio: [0.5],
              };
            case "eth_maxPriorityFeePerGas":
              return "0x3b9aca00";
            case "eth_sendRawTransaction": {
              const raw = String(params[0] ?? "");
              lastReceivedRawTx = raw;
              const tx = ethers.Transaction.from(raw);
              simulatedTxHash = tx.hash || ethers.keccak256(ethers.getBytes(raw));
              if (tx.data && tx.data.length > 10) {
                try {
                  const decoded = iface.decodeFunctionData("anchorRecord", tx.data);
                  lastRecordHash = decoded[0];
                } catch {
                  // Not anchorRecord
                }
              }
              return simulatedTxHash;
            }
            case "eth_getTransactionReceipt": {
              const txHash = String(params[0] ?? simulatedTxHash);
              const eventDesc = iface.getEvent("RecordAnchored");
              const logs: Array<Record<string, unknown>> = [];

              if (receiptStatus === "0x1" && eventDesc) {
                const encodedLog = iface.encodeEventLog(eventDesc, [
                  lastRecordHash,
                  "REF-SUNDARBANS-LOTHIAN-2024-V1",
                  2066200n, // 2066.2 tCO2e in milli-tCO2e
                  1700000000n,
                  SIMULATION_DEPLOYER_ADDRESS,
                ]);

                logs.push({
                  address: STAGING_CONTRACT_ADDRESS,
                  topics: [...encodedLog.topics],
                  data: encodedLog.data,
                  blockNumber: "0x" + currentBlockNumber.toString(16),
                  blockHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                  transactionHash: txHash,
                  transactionIndex: "0x0",
                  logIndex: "0x0",
                  index: "0x0",
                  removed: false,
                });
              }

              return {
                transactionHash: txHash,
                to: STAGING_CONTRACT_ADDRESS.toLowerCase(),
                from: SIMULATION_DEPLOYER_ADDRESS.toLowerCase(),
                blockNumber: "0x" + currentBlockNumber.toString(16),
                blockHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                status: receiptStatus,
                transactionIndex: "0x0",
                index: "0x0",
                gasUsed: "0x1fbd0",
                cumulativeGasUsed: "0x249f0",
                effectiveGasPrice: "0x3b9aca00",
                logsBloom: "0x" + "0".repeat(512),
                logs,
              };
            }
            case "eth_call": {
              // Return verifyRecord tuple: (bool exists, string projectCode, uint256 verifiedCarbonMilliTco2e, uint256 blockNumber, uint256 timestamp, address verifier)
              return iface.encodeFunctionResult("verifyRecord", [
                true,
                "REF-SUNDARBANS-LOTHIAN-2024-V1",
                2066200n,
                BigInt(currentBlockNumber),
                1700000000n,
                SIMULATION_DEPLOYER_ADDRESS,
              ]);
            }
            default:
              return "0x0";
          }
        };

        if (Array.isArray(json)) {
          const results = json.map((reqItem) => ({
            jsonrpc: "2.0",
            id: reqItem.id,
            result: handleMethod(reqItem.method, reqItem.params ?? []),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(results));
        } else {
          const result = handleMethod(json.method, json.params ?? []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  return {
    start: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    getLastReceivedRawTx: () => lastReceivedRawTx,
  };
}

test("Staging Safety Guard: Rejects simulation dummy private key on live remote networks", () => {
  const remoteConfig: EvmConfig = {
    rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/demo-key",
    privateKey: SIMULATION_DUMMY_KEY,
    contract: "0x1111111111111111111111111111111111111111",
    network: "Sepolia Testnet",
    explorerUrl: "https://sepolia.etherscan.io",
    confirmationsRequired: 2,
    expectedChainId: 11155111,
  };

  assert.throws(
    () => assertSafeStagingConfiguration(remoteConfig),
    /SECURITY FATAL: The hard-coded simulation key/,
    "Must throw fatal security error if simulation key is configured on remote RPC",
  );
});

test("Staging Safety Guard: Rejects spoofed remote hosts containing loopback keywords in path, query, or subdomains", () => {
  const testBypassUrls = [
    "https://attacker.example/localhost",
    "https://attacker.example/127.0.0.1",
    "https://attacker.example/api/v1/localhost/rpc",
    "https://attacker.example/?rpc=127.0.0.1",
    "https://attacker.example/?target=localhost",
    "https://attacker.example/#127.0.0.1",
    "https://localhost.attacker.example:8545",
    "https://127.0.0.1.attacker.example:8545",
    "https://attacker.example:[::1]",
    "ftp://127.0.0.1:8545",
    "not-a-valid-url-format",
    "http://127.0.0.1.badsite.com:8545",
    "http://localhost.badsite.com:8545",
  ];

  for (const badUrl of testBypassUrls) {
    const bypassConfig: EvmConfig = {
      rpcUrl: badUrl,
      privateKey: SIMULATION_DUMMY_KEY,
      contract: "0x1111111111111111111111111111111111111111",
      network: "Sepolia Testnet",
      explorerUrl: "https://sepolia.etherscan.io",
      confirmationsRequired: 2,
      expectedChainId: 11155111,
    };

    assert.throws(
      () => assertSafeStagingConfiguration(bypassConfig),
      /SECURITY FATAL: The hard-coded simulation key/,
      `Failed to reject bypass attempt using URL: ${badUrl}`,
    );
  }
});

test("Staging Safety Guard: Approves legitimate local loopback interfaces", () => {
  const validLoopbacks = [
    "http://127.0.0.1:8545",
    "http://127.0.0.1:8545/rpc",
    "http://localhost:8545",
    "http://localhost:8545/v1",
    "http://[::1]:8545",
    "ws://127.0.0.1:8545",
    "ws://localhost:8545",
  ];

  for (const goodUrl of validLoopbacks) {
    const validConfig: EvmConfig = {
      rpcUrl: goodUrl,
      privateKey: SIMULATION_DUMMY_KEY,
      contract: "0x1111111111111111111111111111111111111111",
      network: "Local Hardhat/Anvil Node",
      confirmationsRequired: 1,
      expectedChainId: 31337,
    };

    assert.doesNotThrow(
      () => assertSafeStagingConfiguration(validConfig),
      `Legitimate loopback host incorrectly rejected: ${goodUrl}`,
    );
  }
});

test("Staging Simulation (RPC-Wire): Local in-process HTTP wire server verifies EIP-155 serialization, observable receipts, and confirmation depth", async () => {
  const stagingNode = createStagingRpcWireServer({
    receiptStatus: "0x1",
    blockConfirmations: 3,
  });
  const rpcUrl = await stagingNode.start();

  try {
    const config: EvmConfig = {
      rpcUrl,
      privateKey: SIMULATION_DUMMY_KEY,
      contract: STAGING_CONTRACT_ADDRESS,
      network: "Sepolia Testnet",
      explorerUrl: "https://sepolia.etherscan.io",
      confirmationsRequired: 2,
      expectedChainId: STAGING_CHAIN_ID,
    };

    assertSafeStagingConfiguration(config);

    // 1. Verify staging pre-flight checks: validates chain ID and deployed contract bytecode
    const validation = await validateEVMNetworkAndContract({
      provider: new ethers.JsonRpcProvider(rpcUrl),
      contractAddress: STAGING_CONTRACT_ADDRESS,
      expectedChainId: STAGING_CHAIN_ID,
    });

    assert.strictEqual(validation.isValid, true, "Staging network validation must pass");
    assert.strictEqual(validation.chainId, STAGING_CHAIN_ID);
    assert.strictEqual(validation.hasBytecode, true);
    assert.ok(validation.bytecodeLength > 10);

    // 2. Execute genuine anchoring over the wire protocol
    const provider = createRealEvmProvider(config);
    assert.strictEqual(provider.simulated, false, "Must not be a local simulation");

    const payload: AnchorPayload = {
      project_code: "REF-SUNDARBANS-LOTHIAN-2024-V1",
      project_name: "Lothian Island Mangrove Restoration",
      ecosystem: "MANGROVE",
      state: "West Bengal",
      district: "South 24 Parganas",
      latitude: 21.8542,
      longitude: 88.3245,
      area_hectares: 100.0,
      restoration_start: "2023-01-01T00:00:00Z",
      restoration_end: "2025-01-01T00:00:00Z",
      verified_tco2e: 2066.2,
      methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
      evidence_count: 4,
      evidence_hashes: [
        "cc40a8a2a3ed6cf8c864653f426aae950f4df1da878ae62be06002540829caf2",
        "eb1b84bed2f2f9bb8bfb8a4818ea26ecc0e66270fe634e6bf6a8d68ffd8526aa",
      ],
      verifier_id: "nccr-auditor-dr-das",
      verified_at: "2024-12-20T18:00:00Z",
    };

    const recordHash = ethers.keccak256(ethers.toUtf8Bytes("REF-SUNDARBANS-LOTHIAN-2024-V1"));
    const anchorResult = await provider.anchor(recordHash, payload);

    // Assert that a real signed transaction was transmitted over the wire
    const rawTx = stagingNode.getLastReceivedRawTx();
    assert.ok(rawTx, "Signed raw transaction must be transmitted to eth_sendRawTransaction");
    assert.ok(
      rawTx.startsWith("0x02") || rawTx.startsWith("0xf8"),
      "Must be valid EIP-155 / EIP-1559 envelope",
    );

    // Assert observable receipt fields
    assert.strictEqual(anchorResult.status, "CONFIRMED");
    assert.strictEqual(anchorResult.simulated, false);
    assert.ok(anchorResult.tx_hash.startsWith("0x"));
    assert.ok(anchorResult.block_number! > 5000000);
    assert.ok(anchorResult.confirmations! >= 2);
    assert.ok(anchorResult.explorer_url?.includes("sepolia.etherscan.io"));

    // 3. Verify on-chain verification report via provider
    const verificationReport = await provider.verify(anchorResult.tx_hash, recordHash, {
      project_code: "REF-SUNDARBANS-LOTHIAN-2024-V1",
      verified_tco2e: 2066.2,
    });

    assert.strictEqual(
      verificationReport.isVerified,
      true,
      verificationReport.error ?? "Verification failed",
    );
    assert.strictEqual(verificationReport.receiptStatus, "SUCCESS");
    assert.strictEqual(verificationReport.eventVerified, true);
    assert.strictEqual(verificationReport.anchoredProjectCode, "REF-SUNDARBANS-LOTHIAN-2024-V1");
    assert.strictEqual(verificationReport.anchoredCarbonTco2e, 2066.2);
  } finally {
    await stagingNode.stop();
  }
});

test("Staging Simulation (RPC-Wire): Reverted on-chain transaction fails closed with descriptive status", async () => {
  const stagingNode = createStagingRpcWireServer({
    receiptStatus: "0x0", // Simulates on-chain revert
  });
  const rpcUrl = await stagingNode.start();

  try {
    const config: EvmConfig = {
      rpcUrl,
      privateKey: SIMULATION_DUMMY_KEY,
      contract: STAGING_CONTRACT_ADDRESS,
      network: "Sepolia Testnet",
      explorerUrl: "https://sepolia.etherscan.io",
      confirmationsRequired: 1,
      expectedChainId: STAGING_CHAIN_ID,
    };

    assertSafeStagingConfiguration(config);

    const provider = createRealEvmProvider(config);
    const payload: AnchorPayload = {
      project_code: "REF-REVERT-TEST",
      project_name: "Revert Test Project",
      ecosystem: "MANGROVE",
      state: "West Bengal",
      district: "South 24 Parganas",
      latitude: 21.85,
      longitude: 88.32,
      area_hectares: 10.0,
      restoration_start: "2023-01-01T00:00:00Z",
      restoration_end: "2024-01-01T00:00:00Z",
      verified_tco2e: 100.0,
      methodology: "IPCC-2013",
      evidence_count: 1,
      evidence_hashes: ["abc123hash"],
      verifier_id: "test-verifier",
      verified_at: "2024-01-01T00:00:00Z",
    };

    const revertRecordHash = ethers.keccak256(ethers.toUtf8Bytes("REF-REVERT-TEST"));
    const result = await provider.anchor(revertRecordHash, payload);
    assert.strictEqual(result.status, "FAILED");
    assert.ok(result.error?.includes("reverted"));
  } finally {
    await stagingNode.stop();
  }
});

test("Staging Live Testnet (Opt-In): Genuine on-chain deployment and anchoring against configured Sepolia or Amoy network", async (t) => {
  const liveRpcUrl = process.env["STAGING_RPC_URL"] || process.env["BLOCKCHAIN_RPC_URL"];
  const liveContract =
    process.env["STAGING_CONTRACT_ADDRESS"] || process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  const liveKey = process.env["STAGING_PRIVATE_KEY"] || process.env["BLOCKCHAIN_PRIVATE_KEY"];
  const liveChainIdStr = process.env["STAGING_CHAIN_ID"] || process.env["BLOCKCHAIN_CHAIN_ID"];

  const isLiveConfigured = Boolean(liveRpcUrl && liveContract && liveKey && liveChainIdStr);

  if (!isLiveConfigured) {
    t.skip(
      "Skipping live testnet test. To run against a live testnet, set STAGING_RPC_URL, STAGING_CONTRACT_ADDRESS, STAGING_PRIVATE_KEY, and STAGING_CHAIN_ID.",
    );
    return;
  }

  const chainId = Number(liveChainIdStr);
  assert.ok(
    chainId === 11155111 || chainId === 80002,
    "Live staging chain ID must be Sepolia (11155111) or Polygon Amoy (80002)",
  );

  const config: EvmConfig = {
    rpcUrl: liveRpcUrl!,
    privateKey: liveKey!,
    contract: liveContract!,
    network: chainId === 11155111 ? "Sepolia Testnet" : "Polygon Amoy Testnet",
    explorerUrl:
      chainId === 11155111 ? "https://sepolia.etherscan.io" : "https://amoy.polygonscan.com",
    confirmationsRequired: 2,
    expectedChainId: chainId,
  };

  assertSafeStagingConfiguration(config);

  const provider = createRealEvmProvider(config);
  // Validate network and contract
  const validation = await validateEVMNetworkAndContract({
    provider: new ethers.JsonRpcProvider(config.rpcUrl),
    contractAddress: config.contract,
    expectedChainId: chainId,
  });
  assert.strictEqual(validation.isValid, true, validation.error);
  assert.strictEqual(validation.chainId, chainId);

  // Anchor live payload with unique timestamp to avoid RecordAlreadyAnchored collisions
  const nonce = Date.now();
  const liveProjectCode = `STAGING-TEST-${nonce}`;
  const liveRecordHash = ethers.keccak256(ethers.toUtf8Bytes(liveProjectCode));
  const payload: AnchorPayload = {
    project_code: liveProjectCode,
    project_name: "Staging Testnet Validation Record",
    ecosystem: "MANGROVE",
    state: "West Bengal",
    district: "South 24 Parganas",
    latitude: 21.85,
    longitude: 88.32,
    area_hectares: 10.0,
    restoration_start: "2024-01-01T00:00:00Z",
    restoration_end: "2025-01-01T00:00:00Z",
    verified_tco2e: 150.0,
    methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
    evidence_count: 1,
    evidence_hashes: [ethers.keccak256(ethers.toUtf8Bytes(`evidence-${nonce}`))],
    verifier_id: "staging-automated-test-runner",
    verified_at: new Date().toISOString(),
  };

  const result = await provider.anchor(liveRecordHash, payload);
  assert.strictEqual(result.status, "CONFIRMED");
  assert.strictEqual(result.simulated, false);
  assert.ok(result.tx_hash.startsWith("0x"));

  const verification = await provider.verify(result.tx_hash, liveRecordHash, {
    project_code: liveProjectCode,
    verified_tco2e: 150.0,
  });
  assert.strictEqual(verification.isVerified, true, verification.error);
  assert.strictEqual(verification.receiptStatus, "SUCCESS");

  const liveReceiptRecord = {
    executed_at: new Date().toISOString(),
    network: config.network,
    chain_id: chainId,
    contract_address: config.contract,
    transaction_hash: result.tx_hash,
    block_number: result.block_number,
    confirmations: verification.confirmations,
    receipt_status: verification.receiptStatus,
    explorer_url: `${config.explorerUrl}/tx/${result.tx_hash}`,
    record_hash: liveRecordHash,
    project_code: liveProjectCode,
  };
  console.log("=== LIVE TESTNET TRANSACTION CONFIRMED ===");
  console.log(JSON.stringify(liveReceiptRecord, null, 2));
});
