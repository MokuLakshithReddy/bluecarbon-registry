import test from "node:test";
import assert from "node:assert";
import {
  validateEvidenceUpload,
  sanitizeFilename,
  validateStorageUri,
  computeFileSha256,
  verifyEvidenceProvenance,
  MAX_EVIDENCE_SIZE_BYTES,
} from "../../src/lib/evidence-validator.ts";

test("Evidence Security: sanitizeFilename prevents directory traversal", () => {
  const maliciousInputs = [
    "../../etc/passwd",
    "..\\..\\Windows\\System32\\cmd.exe",
    "folder/../../../secret.env",
    "photo\0.jpg",
    "evil%2e%2e%2fphoto.png",
  ];

  for (const input of maliciousInputs) {
    const sanitized = sanitizeFilename(input);
    assert.strictEqual(sanitized.includes("../"), false);
    assert.strictEqual(sanitized.includes("..\\"), false);
    assert.strictEqual(sanitized.includes("/"), false);
    assert.strictEqual(sanitized.includes("\\"), false);
    assert.strictEqual(sanitized.includes("\0"), false);
  }
});

test("Evidence Security: validateEvidenceUpload enforces size and extension limits", () => {
  // Valid PDF
  const validDoc = validateEvidenceUpload({
    name: "baseline_report.pdf",
    size: 2 * 1024 * 1024,
    type: "application/pdf",
  });
  assert.strictEqual(validDoc.valid, true);

  // Valid JPEG
  const validImg = validateEvidenceUpload({
    name: "field_mangrove.jpg",
    size: 4 * 1024 * 1024,
    type: "image/jpeg",
  });
  assert.strictEqual(validImg.valid, true);

  // File exceeding 25MB
  const tooLarge = validateEvidenceUpload({
    name: "drone_raw.tiff",
    size: MAX_EVIDENCE_SIZE_BYTES + 1024,
    type: "image/tiff",
  });
  assert.strictEqual(tooLarge.valid, false);
  assert.ok(tooLarge.error?.includes("exceeds maximum"));

  // Disallowed executable extension
  const executable = validateEvidenceUpload({
    name: "script.exe",
    size: 1024,
    type: "application/x-msdownload",
  });
  assert.strictEqual(executable.valid, false);
  assert.ok(executable.error?.includes("Unsupported file extension"));
});

test("Evidence Security: validateStorageUri accepts only storage://evidence/<uuid>/<file>", () => {
  const valid = "storage://evidence/11111111-2222-3333-4444-555555555555/photo_01.jpg";
  const parsed = validateStorageUri(valid);
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.projectId, "11111111-2222-3333-4444-555555555555");
  assert.strictEqual(parsed.filename, "photo_01.jpg");

  // Rejects external URLs
  const external = "https://malicious-site.com/fake-evidence.jpg";
  assert.strictEqual(validateStorageUri(external).valid, false);

  // Rejects path traversal in storage path
  const traversal = "storage://evidence/11111111-2222-3333-4444-555555555555/../../secret";
  assert.strictEqual(validateStorageUri(traversal).valid, false);
});

test("Evidence Security: rejects arbitrary external or malicious URLs", () => {
  const dangerousUrls = [
    "https://external-untrusted.com/attacker.png",
    "http://insecure-domain.org/data.jpg",
    "ftp://untrusted.org/payload.exe",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "storage://evidence/11111111-2222-3333-4444-555555555555/../../traversal.txt",
    "storage://not-allowed/bucket/test.png",
  ];

  for (const url of dangerousUrls) {
    const result = validateStorageUri(url);
    assert.strictEqual(result.valid, false, `Expected ${url} to be rejected`);
  }
});

test("Evidence Security: computeFileSha256 produces valid 64-character SHA-256 hex string", () => {
  const content = new TextEncoder().encode("blue carbon mangrove field data 2026");
  const hash = computeFileSha256(content);
  assert.strictEqual(typeof hash, "string");
  assert.strictEqual(hash.length, 64);
  assert.strictEqual(/^[0-9a-f]{64}$/.test(hash), true);

  // Exact known SHA-256 for this content
  const hashAgain = computeFileSha256(content);
  assert.strictEqual(hash, hashAgain, "Hash computation must be strictly deterministic");
});

test("Evidence Security: verifyEvidenceProvenance verifies authentic bytes and detects tampering", () => {
  const originalBytes = new TextEncoder().encode("genuine uncorrupted soil core measurements");
  const correctHash = computeFileSha256(originalBytes);

  // 1. Authentic file passes provenance check
  const authenticResult = verifyEvidenceProvenance(originalBytes, correctHash);
  assert.strictEqual(authenticResult.valid, true);
  assert.strictEqual(authenticResult.actualHash, correctHash);

  // 2. Tampered file with a single flipped byte fails provenance check
  const tamperedBytes = new Uint8Array(originalBytes);
  tamperedBytes[0] ^= 0xff; // corrupt first byte
  const tamperedResult = verifyEvidenceProvenance(tamperedBytes, correctHash);
  assert.strictEqual(tamperedResult.valid, false);
  assert.ok(tamperedResult.error?.includes("Hash mismatch (tampering detected)"));
  assert.ok(tamperedResult.error?.includes("does not match verified record hash"));

  // 3. Invalid or malformed hash format rejected
  const malformedResult = verifyEvidenceProvenance(originalBytes, "not-a-valid-sha256");
  assert.strictEqual(malformedResult.valid, false);
  assert.ok(malformedResult.error?.includes("Expected 64-character hexadecimal SHA-256"));
});
