import test from "node:test";
import assert from "node:assert";
import {
  parseDecentralizedUri,
  resolveGatewayUrls,
  validateEvidencePackManifest,
} from "../../src/lib/decentralized-storage.ts";

test("Decentralized Storage: Parses and validates IPFS CIDv0 and CIDv1 URIs", () => {
  // CIDv0 (Qm...)
  const v0 = parseDecentralizedUri("ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco");
  assert.strictEqual(v0.protocol, "ipfs");
  assert.strictEqual(v0.identifier, "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco");

  // CIDv1 (bafy...)
  const v1 = parseDecentralizedUri(
    "ipfs://bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8/geotiff/mangrove-extent.tif",
  );
  assert.strictEqual(v1.protocol, "ipfs");
  assert.strictEqual(v1.identifier, "bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8");
  assert.strictEqual(v1.path, "geotiff/mangrove-extent.tif");

  const gateways = resolveGatewayUrls(
    "ipfs://bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8",
  );
  assert.ok(gateways.length >= 2);
  assert.ok(gateways[0]?.startsWith("https://ipfs.io/ipfs/"));
});

test("Decentralized Storage: Parses and validates Arweave transaction identifiers", () => {
  const ar = parseDecentralizedUri(
    "ar://yRj4a5KMzkXgn7YAS4GE7L63trqKGaFYNun4985N4Sg/soil-cores.pdf",
  );
  assert.strictEqual(ar.protocol, "arweave");
  assert.strictEqual(ar.identifier, "yRj4a5KMzkXgn7YAS4GE7L63trqKGaFYNun4985N4Sg");
  assert.strictEqual(ar.path, "soil-cores.pdf");

  const gateways = resolveGatewayUrls("ar://yRj4a5KMzkXgn7YAS4GE7L63trqKGaFYNun4985N4Sg");
  assert.ok(gateways.some((g) => g.includes("arweave.net")));
});

test("Decentralized Storage: Fails closed on invalid schemes, malformed CIDs, or HTTP URLs", () => {
  assert.throws(
    () => parseDecentralizedUri("https://arbitrary-server.com/malicious.pdf"),
    /Unsupported decentralized storage URI scheme/,
  );
  assert.throws(
    () => parseDecentralizedUri("ftp://server.org/data"),
    /Unsupported decentralized storage URI scheme/,
  );
  assert.throws(
    () => parseDecentralizedUri("ipfs://not-a-valid-cid-1234"),
    /Invalid IPFS Content Identifier/,
  );
  assert.throws(
    () => parseDecentralizedUri("ar://too-short"),
    /Invalid Arweave transaction identifier/,
  );
});

test("Decentralized Storage: Validates comprehensive Verification Evidence Pack Manifest", () => {
  const validManifest = {
    projectId: "00000000-0000-0000-0000-000000000001",
    vintageYear: 2026,
    methodology: "IPCC-WETLANDS-2013-VM0033",
    geoTiffRasterUri:
      "ipfs://bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8/raster.tif",
    multispectralNdviUri:
      "ipfs://bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8/ndvi.png",
    soilCoreLabReportUri: "ar://yRj4a5KMzkXgn7YAS4GE7L63trqKGaFYNun4985N4Sg",
    auditorSignoffUri: "ar://zRj4a5KMzkXgn7YAS4GE7L63trqKGaFYNun4985N4Sh",
    createdAt: "2026-10-21T00:00:00Z",
  };

  const validation = validateEvidencePackManifest(validManifest);
  assert.strictEqual(validation.isValid, true);
  assert.strictEqual(validation.errors.length, 0);

  // Invalid manifest with bad URI
  const invalidManifest = {
    ...validManifest,
    geoTiffRasterUri: "https://untrusted-host.com/fake.tif",
  };
  const invalidRes = validateEvidencePackManifest(invalidManifest);
  assert.strictEqual(invalidRes.isValid, false);
  assert.ok(invalidRes.errors.length > 0);
});
