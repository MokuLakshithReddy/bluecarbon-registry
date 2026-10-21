import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ethers } from "ethers";
import {
  createEvmProvider,
  toMilliTco2e,
  fromMilliTco2e,
  BLUE_CARBON_REGISTRY_ABI,
  type AnchorPayload,
  type BlockchainConfig,
} from "../../src/lib/blockchain.server.ts";

const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);

// A private key for testing only
const TEST_SIGNER_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";

interface MockRpcOptions {
  receiptStatus?: "0x1" | "0x0";
  recordExists?: boolean;
  receiptToAddress?: string;
  emitExpectedEvent?: boolean;
}

function startMockRpcServer(opts: MockRpcOptions = {}) {
  const receiptStatus = opts.receiptStatus ?? "0x1";
  const recordExists = opts.recordExists ?? true;
  const receiptTo = (opts.receiptToAddress ?? TEST_CONTRACT_ADDRESS).toLowerCase();
  const emitEvent = opts.emitExpectedEvent ?? true;

  let receivedRawTx: string | null = null;
  let decodedAnchorArgs: ethers.Result | null = null;

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
              return "0xaa36a7"; // 11155111 Sepolia
            case "eth_blockNumber":
              return "0x105"; // 261
            case "eth_getBlockByNumber":
              return {
                number: "0x100",
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
            case "eth_getTransactionCount":
              return "0x0";
            case "eth_estimateGas":
              return "0x186a0"; // 100,000 gas
            case "eth_gasPrice":
              return "0x3b9aca00"; // 1 Gwei
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
              receivedRawTx = raw;
              const tx = ethers.Transaction.from(raw);
              if (tx.data && tx.data.length > 10) {
                try {
                  decodedAnchorArgs = iface.decodeFunctionData("anchorRecord", tx.data);
                } catch {
                  // Not anchorRecord
                }
              }
              return tx.hash;
            }
            case "eth_getTransactionReceipt": {
              const logs: Array<{ address: string; topics: string[]; data: string }> = [];
              if (emitEvent) {
                const eventDesc = iface.getEvent("RecordAnchored");
                if (eventDesc) {
                  const encodedLog = iface.encodeEventLog(eventDesc, [
                    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                    "BC-MNG-0001",
                    520650n,
                    1700000000n,
                    TEST_CONTRACT_ADDRESS,
                  ]);
                  logs.push({
                    address: TEST_CONTRACT_ADDRESS,
                    topics: [...encodedLog.topics],
                    data: encodedLog.data,
                    blockNumber: "0x100",
                    blockHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                    transactionHash: String(params[0]),
                    transactionIndex: "0x0",
                    logIndex: "0x0",
                    removed: false,
                  });
                }
              }

              return {
                transactionHash: params[0],
                to: receiptTo,
                blockNumber: "0x100",
                blockHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                status: receiptStatus,
                transactionIndex: "0x0",
                gasUsed: "0x5208",
                cumulativeGasUsed: "0x5208",
                logs,
              };
            }
            case "eth_call": {
              // Return verifyRecord tuple: (bool exists, string projectCode, uint256 verifiedCarbonMilliTco2e, uint256 blockNumber, uint256 timestamp, address verifier)
              const encoded = iface.encodeFunctionResult("verifyRecord", [
                recordExists,
                "BC-MNG-0001",
                520650n,
                256n,
                1700000000n,
                TEST_CONTRACT_ADDRESS,
              ]);
              return encoded;
            }
            default:
              return "0x0";
          }
        };

        if (Array.isArray(json)) {
          const results = json.map(
            (item: { method: string; params?: unknown[]; id?: unknown }) => ({
              jsonrpc: "2.0",
              id: item.id,
              result: handleMethod(item.method, item.params || []),
            }),
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(results));
        } else {
          const result = handleMethod(json.method, json.params || []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Internal RPC error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { message: msg } }));
      }
    });
  });

  return new Promise<{
    url: string;
    close: () => Promise<void>;
    getReceivedTx: () => string | null;
    getDecodedArgs: () => ethers.Result | null;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as import("node:net").AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
        getReceivedTx: () => receivedRawTx,
        getDecodedArgs: () => decodedAnchorArgs,
      });
    });
  });
}

test("Carbon Precision Scaling: toMilliTco2e and fromMilliTco2e preserve 3 decimal places without truncation", () => {
  const decimalValue = 520.654;
  const scaled = toMilliTco2e(decimalValue);
  assert.strictEqual(scaled, 520654n);

  const descaled = fromMilliTco2e(scaled);
  assert.strictEqual(descaled, 520.654);

  // Round trip for 0.001 tCO2e (1 kg CO2e)
  assert.strictEqual(toMilliTco2e(0.001), 1n);
  assert.strictEqual(fromMilliTco2e(1n), 0.001);
});

test("EVM Provider: submits genuine signed contract transaction with fixed-point precision, polls receipt, and verifies event", async () => {
  const mockRpc = await startMockRpcServer({ receiptStatus: "0x1", recordExists: true });

  try {
    const config: BlockchainConfig = {
      network: "sepolia",
      rpcUrl: mockRpc.url,
      contract: TEST_CONTRACT_ADDRESS,
      privateKey: TEST_SIGNER_KEY,
      confirmationsRequired: 1,
      timeoutMs: 5000,
      explorerUrl: "https://sepolia.etherscan.io",
    };

    const provider = createEvmProvider(config);
    const testPayload: AnchorPayload = {
      project_code: "BC-MNG-0001",
      project_name: "Pichavaram Mangrove Conservation",
      ecosystem: "MANGROVE",
      state: "Tamil Nadu",
      district: "Cuddalore",
      latitude: 11.43,
      longitude: 79.78,
      area_hectares: 25,
      restoration_start: "2024-01-01",
      restoration_end: "2026-01-01",
      verified_tco2e: 520.65, // Decimal precision value!
      methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
      evidence_count: 5,
      evidence_hashes: ["abc1", "abc2"],
      verifier_id: "00000000-0000-0000-0000-000000000001",
      verified_at: "2026-10-21T00:00:00.000Z",
    };

    const recordHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const result = await provider.anchor(recordHash, testPayload);

    // 1. Verify that transaction submission succeeded and was NOT simulated
    assert.strictEqual(result.status, "CONFIRMED");
    assert.strictEqual(result.simulated, false);
    assert.ok(result.tx_hash.startsWith("0x"));
    assert.strictEqual(result.block_number, 256);
    assert.ok(result.explorer_url?.includes(result.tx_hash));

    // 2. Verify fixed-point scaling in anchorRecord calldata (520.65 -> 520650n milli-tCO2e)
    const decodedArgs = mockRpc.getDecodedArgs();
    assert.ok(decodedArgs != null, "anchorRecord calldata must have been signed and sent");
    assert.strictEqual(decodedArgs[0], recordHash);
    assert.strictEqual(decodedArgs[1], "BC-MNG-0001");
    assert.strictEqual(
      decodedArgs[2],
      520650n,
      "Carbon must be scaled by 1,000 without decimal truncation",
    );

    // 3. Verify on-chain verification report parses receipt event and reads contract state
    const verifyReport = await provider.verify(result.tx_hash, recordHash);
    assert.strictEqual(verifyReport.isVerified, true);
    assert.strictEqual(verifyReport.simulated, false);
    assert.strictEqual(verifyReport.receiptStatus, "SUCCESS");
    assert.strictEqual(verifyReport.eventVerified, true);
    assert.strictEqual(verifyReport.contractVerified, true);
    assert.strictEqual(verifyReport.anchoredCarbonTco2e, 520.65);
    assert.strictEqual(verifyReport.anchoredProjectCode, "BC-MNG-0001");
  } finally {
    await mockRpc.close();
  }
});

test("EVM Provider: verification fails if transaction called an unexpected contract address", async () => {
  const WRONG_CONTRACT = "0x9999999999999999999999999999999999999999";
  const mockRpc = await startMockRpcServer({
    receiptStatus: "0x1",
    receiptToAddress: WRONG_CONTRACT,
  });

  try {
    const config: BlockchainConfig = {
      network: "sepolia",
      rpcUrl: mockRpc.url,
      contract: TEST_CONTRACT_ADDRESS,
      privateKey: TEST_SIGNER_KEY,
      confirmationsRequired: 1,
      timeoutMs: 5000,
    };

    const provider = createEvmProvider(config);
    const report = await provider.verify(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );

    assert.strictEqual(report.isVerified, false);
    assert.ok(report.error?.includes("expected registry contract"));
  } finally {
    await mockRpc.close();
  }
});

test("EVM Provider: verification fails if transaction receipt did not emit RecordAnchored event", async () => {
  const mockRpc = await startMockRpcServer({
    receiptStatus: "0x1",
    emitExpectedEvent: false,
  });

  try {
    const config: BlockchainConfig = {
      network: "sepolia",
      rpcUrl: mockRpc.url,
      contract: TEST_CONTRACT_ADDRESS,
      privateKey: TEST_SIGNER_KEY,
      confirmationsRequired: 1,
      timeoutMs: 5000,
    };

    const provider = createEvmProvider(config);
    const report = await provider.verify(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );

    assert.strictEqual(report.isVerified, false);
    assert.strictEqual(report.eventVerified, false);
    assert.ok(report.error?.includes("RecordAnchored event"));
  } finally {
    await mockRpc.close();
  }
});

test("EVM Provider: returns status FAILED when transaction reverts on-chain (never CONFIRMED)", async () => {
  const mockRpc = await startMockRpcServer({ receiptStatus: "0x0" });

  try {
    const config: BlockchainConfig = {
      network: "sepolia",
      rpcUrl: mockRpc.url,
      contract: TEST_CONTRACT_ADDRESS,
      privateKey: TEST_SIGNER_KEY,
      confirmationsRequired: 1,
      timeoutMs: 5000,
    };

    const provider = createEvmProvider(config);
    const testPayload: AnchorPayload = {
      project_code: "BC-MNG-REVERT",
      project_name: "Failed Project",
      ecosystem: "MANGROVE",
      state: "Goa",
      district: "North Goa",
      latitude: 15.5,
      longitude: 73.8,
      area_hectares: 10,
      restoration_start: "2024-01-01",
      restoration_end: "2026-01-01",
      verified_tco2e: 100,
      methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
      evidence_count: 1,
      evidence_hashes: ["abc1"],
      verifier_id: "00000000-0000-0000-0000-000000000001",
      verified_at: "2026-10-21T00:00:00.000Z",
    };

    const recordHash = "0x9999999999999999999999999999999999999999999999999999999999999999";
    const result = await provider.anchor(recordHash, testPayload);

    assert.strictEqual(result.status, "FAILED");
    assert.strictEqual(result.simulated, false);
    assert.ok(result.error?.includes("revert"));
  } finally {
    await mockRpc.close();
  }
});

test("EVM Provider: reports FAILED when RPC is unreachable (never fabricates hashes)", async () => {
  const config: BlockchainConfig = {
    network: "sepolia",
    rpcUrl: "http://127.0.0.1:59999/unreachable-rpc",
    contract: TEST_CONTRACT_ADDRESS,
    privateKey: TEST_SIGNER_KEY,
    confirmationsRequired: 1,
    timeoutMs: 1000,
  };

  const provider = createEvmProvider(config);
  const testPayload: AnchorPayload = {
    project_code: "BC-MNG-UNREACHABLE",
    project_name: "Unreachable Project",
    ecosystem: "MANGROVE",
    state: "Goa",
    district: "North Goa",
    latitude: 15.5,
    longitude: 73.8,
    area_hectares: 10,
    restoration_start: "2024-01-01",
    restoration_end: "2026-01-01",
    verified_tco2e: 100,
    methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
    evidence_count: 1,
    evidence_hashes: ["abc1"],
    verifier_id: "00000000-0000-0000-0000-000000000001",
    verified_at: "2026-10-21T00:00:00.000Z",
  };

  const recordHash = "0x8888888888888888888888888888888888888888888888888888888888888888";
  const result = await provider.anchor(recordHash, testPayload);

  assert.strictEqual(result.status, "FAILED");
  assert.strictEqual(result.simulated, false);
  assert.strictEqual(result.tx_hash, "");
  assert.ok(result.error != null);
});
