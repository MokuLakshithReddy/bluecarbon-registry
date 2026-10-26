import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ethers } from "ethers";
import {
  createRealEvmProvider,
  validateEVMNetworkAndContract,
  BLUE_CARBON_REGISTRY_ABI,
  type AnchorPayload,
  type EvmConfig,
} from "../../src/lib/blockchain.server.ts";

const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);

// Test fixtures
const STAGING_CHAIN_ID = 11155111; // Ethereum Sepolia Staging Testnet
const STAGING_CONTRACT_ADDRESS = "0x7777777777777777777777777777777777777777";
const STAGING_DEPLOYER_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const STAGING_DEPLOYER_ADDRESS = new ethers.Wallet(STAGING_DEPLOYER_KEY).address;

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
                  STAGING_DEPLOYER_ADDRESS,
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
                from: STAGING_DEPLOYER_ADDRESS.toLowerCase(),
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
                STAGING_DEPLOYER_ADDRESS,
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

test("Staging Network vs Local EVM: Architectural boundary validation", () => {
  // Local in-process EVM operates in memory without network stack
  assert.strictEqual(
    typeof createRealEvmProvider,
    "function",
    "createRealEvmProvider handles network-level JSON-RPC transport",
  );
  assert.strictEqual(
    typeof validateEVMNetworkAndContract,
    "function",
    "validateEVMNetworkAndContract verifies network chainId and deployed bytecode",
  );
});

test("Staging Network: Live RPC wire simulation enforces chain identity, sends signed raw transaction, and verifies observable transaction receipt", async () => {
  const stagingNode = createStagingRpcWireServer({
    receiptStatus: "0x1",
    blockConfirmations: 3,
  });
  const rpcUrl = await stagingNode.start();

  try {
    const config: EvmConfig = {
      rpcUrl,
      privateKey: STAGING_DEPLOYER_KEY,
      contract: STAGING_CONTRACT_ADDRESS,
      network: "Sepolia Testnet",
      explorerUrl: "https://sepolia.etherscan.io",
      confirmationsRequired: 2,
      expectedChainId: STAGING_CHAIN_ID,
    };

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

test("Staging Network: Reverted on-chain transaction fails closed with descriptive status", async () => {
  const stagingNode = createStagingRpcWireServer({
    receiptStatus: "0x0", // Simulates on-chain revert
  });
  const rpcUrl = await stagingNode.start();

  try {
    const config: EvmConfig = {
      rpcUrl,
      privateKey: STAGING_DEPLOYER_KEY,
      contract: STAGING_CONTRACT_ADDRESS,
      network: "Sepolia Testnet",
      explorerUrl: "https://sepolia.etherscan.io",
      confirmationsRequired: 1,
      expectedChainId: STAGING_CHAIN_ID,
    };

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
