import test from "node:test";
import assert from "node:assert";
import {
  classifyWalletError,
  FallbackRpcProviderManager,
  type RpcEndpointConfig,
} from "../../src/lib/rpc-resilience.ts";
import { BlockchainEventIndexer } from "../../src/lib/event-indexer.server.ts";

test("RPC Resilience: Classifies wallet errors into granular, actionable states", () => {
  // 1. User rejection
  const userRejected = classifyWalletError({ code: 4001, message: "User rejected transaction" });
  assert.strictEqual(userRejected.code, "USER_REJECTED");
  assert.strictEqual(userRejected.isRetryable, true);

  // 2. Unrecognized chain / chain switch
  const chainMismatch = classifyWalletError({ code: 4902, message: "Unrecognized chain ID" });
  assert.strictEqual(chainMismatch.code, "UNRECOGNIZED_CHAIN");

  // 3. Rate limited (429)
  const rateLimited = classifyWalletError(
    new Error("HTTP 429 Too Many Requests: node rate limited"),
  );
  assert.strictEqual(rateLimited.code, "RPC_RATE_LIMITED");
  assert.strictEqual(rateLimited.isRetryable, true);

  // 4. Gas price spike
  const gasSpike = classifyWalletError(new Error("replacement fee too low"));
  assert.strictEqual(gasSpike.code, "GAS_PRICE_SPIKE");

  // 5. Revert
  const revertErr = classifyWalletError(new Error("execution reverted: UnauthorizedVerifier"));
  assert.strictEqual(revertErr.code, "CONTRACT_REVERTED");
  assert.strictEqual(revertErr.isRetryable, false);
});

test("RPC Resilience: FallbackRpcProviderManager executes automatic failover on endpoint failure", async () => {
  const endpoints: RpcEndpointConfig[] = [
    {
      name: "Failing Primary Node",
      url: "http://127.0.0.1:59991/failing-primary",
      priority: 1,
      expectedChainId: 11155111,
      timeoutMs: 200,
    },
    {
      name: "Working Backup Node",
      url: "http://127.0.0.1:59992/working-backup",
      priority: 2,
      expectedChainId: 11155111,
      timeoutMs: 200,
    },
  ];

  const manager = new FallbackRpcProviderManager(endpoints);
  assert.strictEqual(manager.getActiveEndpoint().name, "Failing Primary Node");

  let triedPrimary = false;
  let triedBackup = false;

  const result = await manager.executeWithFailover(async (_provider, endpoint) => {
    if (endpoint.name === "Failing Primary Node") {
      triedPrimary = true;
      throw new Error("HTTP 429 Rate Limit Exceeded");
    }
    if (endpoint.name === "Working Backup Node") {
      triedBackup = true;
      return "SUCCESS_FROM_BACKUP";
    }
    throw new Error("Unknown node");
  });

  assert.strictEqual(triedPrimary, true, "Must have attempted primary node first");
  assert.strictEqual(triedBackup, true, "Must have failed over to backup node");
  assert.strictEqual(result, "SUCCESS_FROM_BACKUP");
  assert.strictEqual(manager.getActiveEndpoint().name, "Working Backup Node");
});

test("Event Indexer: Indexes on-chain events and serves fast paginated queries without RPC load", () => {
  const indexer = new BlockchainEventIndexer();

  const recordHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  // 1. Index mint
  indexer.indexCreditBatch({
    recordHash,
    projectCode: "BC-MNG-GOA-01",
    totalMintedMilli: 500_000n,
    circulatingMilli: 425_000n, // 85%
    bufferPoolMilli: 75_000n, // 15%
    vintageYear: 2026,
    minter: "0x1111111111111111111111111111111111111111",
    txHash: "0xabc",
    blockNumber: 1000,
  });

  // Query batch from index
  const batch = indexer.getCreditBatch(recordHash);
  assert.ok(batch);
  assert.strictEqual(batch.projectCode, "BC-MNG-GOA-01");
  assert.strictEqual(batch.circulatingMilli, 425_000n);

  // 2. Index retirement
  const certId = "0xcert000000000000000000000000000000000000000000000000000000000001";
  indexer.indexRetirement({
    certificateId: certId,
    recordHash,
    retiree: "0x2222222222222222222222222222222222222222",
    beneficiary: "Infosys Net-Zero Campus 2026",
    amountMilliTco2e: 100_000n,
    retirementReason: "Data Center Scope 2 Emissions Offsetting",
    timestamp: 1770001000,
    txHash: "0xdef",
    blockNumber: 1005,
  });

  // Circulating reduced in cache
  const updatedBatch = indexer.getCreditBatch(recordHash);
  assert.strictEqual(updatedBatch?.circulatingMilli, 325_000n);

  // Fast query retirement certificate
  const cert = indexer.getRetirementCertificate(certId);
  assert.strictEqual(cert?.beneficiary, "Infosys Net-Zero Campus 2026");

  // Search by beneficiary query
  const searchResult = indexer.queryRetirements({ beneficiarySearch: "infosys" });
  assert.strictEqual(searchResult.total, 1);
  assert.strictEqual(searchResult.items[0]?.certificateId, certId);
});
