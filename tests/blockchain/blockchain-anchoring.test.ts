import test from "node:test";
import assert from "node:assert";
import {
  canonicalize,
  sha256Hex,
  anchorVerifiedRecord,
  verifyOnChainAnchor,
  type AnchorPayload,
} from "../../src/lib/blockchain.server.ts";

test("Blockchain Anchoring: canonicalize produces key-sorted deterministic JSON", () => {
  const obj1 = { z: 100, b: "hello", a: true, list: [3, 2, 1] };
  const obj2 = { a: true, list: [3, 2, 1], z: 100, b: "hello" };

  const canon1 = canonicalize(obj1);
  const canon2 = canonicalize(obj2);

  assert.strictEqual(canon1, canon2);
  assert.strictEqual(canon1, '{"a":true,"b":"hello","list":[3,2,1],"z":100}');
});

test("Blockchain Anchoring: sha256Hex produces identical digest for canonically sorted objects", async () => {
  const payloadA = { project_code: "BCR-MANG-0001", verified_tco2e: 4500, state: "Odisha" };
  const payloadB = { state: "Odisha", project_code: "BCR-MANG-0001", verified_tco2e: 4500 };

  const hashA = await sha256Hex(canonicalize(payloadA));
  const hashB = await sha256Hex(canonicalize(payloadB));

  assert.strictEqual(hashA, hashB);
  assert.strictEqual(hashA.length, 64);
  assert.match(hashA, /^[0-9a-f]{64}$/);
});

test("Blockchain Anchoring: simulated provider explicitly flags simulated = true, status = SIMULATED, and explorer_url = null", async () => {
  const dummyPayload: AnchorPayload = {
    project_code: "BCR-TEST-0001",
    project_name: "Chilika Mangrove Restoration",
    ecosystem: "MANGROVE",
    state: "Odisha",
    district: "Puri",
    latitude: 19.8,
    longitude: 85.5,
    area_hectares: 25,
    restoration_start: "2024-01-01",
    restoration_end: "2026-01-01",
    verified_tco2e: 1200,
    methodology: "IPCC-WETLANDS-2013-VM0033-V2.1",
    evidence_count: 4,
    evidence_hashes: ["hash1", "hash2"],
    verifier_id: "00000000-0000-0000-0000-000000000001",
    verified_at: "2026-10-21T00:00:00.000Z",
  };

  const result = await anchorVerifiedRecord(dummyPayload);

  assert.ok(result.record_hash);
  assert.ok(result.tx_hash);
  // CRITICAL AUDIT CHECK: Simulated provider returns SIMULATED status, never CONFIRMED
  assert.strictEqual(result.status, "SIMULATED");
  assert.strictEqual(result.simulated, true);
  // CRITICAL AUDIT CHECK: explorer_url must be null, never generating misleading explorer links
  assert.strictEqual(result.explorer_url, null);
  assert.ok(result.network.toLowerCase().includes("simulat"));
});

test("Blockchain Anchoring: verifyOnChainAnchor rejects simulated records as real on-chain proofs", async () => {
  const report = await verifyOnChainAnchor("0x1234567890abcdef", "abcdef1234567890");

  // CRITICAL AUDIT CHECK: Simulated records can NEVER be presented as genuine on-chain proofs
  assert.strictEqual(report.isVerified, false);
  assert.strictEqual(report.simulated, true);
  assert.ok(report.error?.includes("Simulated demonstration anchor"));
});
