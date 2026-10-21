/**
 * Cross-Project Evidence Path Binding & Traversal Hardening Tests
 *
 * Audit References:
 *   P1 — Evidence storage paths must be bound to the approved project.
 *   P1 — Path traversal must be rejected; paths must be normalized safely.
 *
 * IMPORTANT: This file imports resolveEvidenceStoragePath directly from the
 * production module (src/lib/evidence-storage-path.ts).  There is no inline
 * replica of the logic here.  If the production implementation changes, these
 * tests will automatically pick up the change and fail if the new behavior
 * breaks a security invariant.
 */

import test from "node:test";
import assert from "node:assert";
import { resolveEvidenceStoragePath } from "../../src/lib/evidence-storage-path.ts";

// ─── Test fixtures ───────────────────────────────────────────────────────────

const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_FILE = "baseline_report.pdf";

/** Shorthand helpers */
function accepted(url: string, projectId = PROJECT_A, name = "evidence") {
  const r = resolveEvidenceStoragePath(url, projectId, name);
  assert.strictEqual(r.error, null, `Expected accepted but got error: ${r.error}`);
  assert.ok(r.storagePath, "Expected a non-null storagePath");
  return r.storagePath!;
}
function rejected(url: string, projectId = PROJECT_A, name = "evidence") {
  const r = resolveEvidenceStoragePath(url, projectId, name);
  assert.ok(r.error, `Expected rejection but got storagePath: ${r.storagePath}`);
  assert.strictEqual(r.storagePath, null);
  return r.error!;
}

// ─── Section 1: Canonical storage:// URIs — happy path ───────────────────────

test("Path binding: valid canonical URI for the approved project is accepted", () => {
  const path = accepted(`storage://evidence/${PROJECT_A}/${VALID_FILE}`);
  assert.strictEqual(path, `${PROJECT_A}/${VALID_FILE}`);
});

test("Path binding: canonical URI with a nested sub-path is accepted", () => {
  const path = accepted(`storage://evidence/${PROJECT_A}/2026/october/report.pdf`);
  assert.strictEqual(path, `${PROJECT_A}/2026/october/report.pdf`);
});

// ─── Section 2: Cross-project ownership binding ───────────────────────────────

test("Cross-project: storage:// URI referencing a different project UUID is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_B}/${VALID_FILE}`);
  assert.ok(err.includes("Cross-project evidence references are not permitted"));
  assert.ok(err.includes(PROJECT_B));
  assert.ok(err.includes(PROJECT_A));
});

test("Cross-project: storage:// URI with an arbitrary foreign UUID is rejected", () => {
  const foreign = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const err = rejected(`storage://evidence/${foreign}/file.pdf`);
  assert.ok(err.includes("Cross-project evidence references are not permitted"));
});

// ─── Section 3: Path traversal — canonical storage:// URIs ───────────────────

test("Traversal: <project>/../<project>/file.pdf is rejected", () => {
  // Filename portion contains a traversal to escape the project directory.
  const err = rejected(`storage://evidence/${PROJECT_A}/../${PROJECT_A}/file.pdf`);
  assert.ok(
    err.includes("traversal") || err.includes("does not resolve"),
    `Expected traversal or resolution error, got: ${err}`,
  );
});

test("Traversal: <project>/../../etc/passwd is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/../../etc/passwd`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

test("Traversal: <project>/sub/../file.pdf — dot-dot in middle of filename — is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/sub/../file.pdf`);
  assert.ok(err.includes("traversal") || err.includes("segment"));
});

test("Traversal: <project>/./file.pdf — single dot segment — is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/./file.pdf`);
  assert.ok(err.includes("traversal") || err.includes("segment"));
});

test("Traversal: <project>// — empty segment from double slash — is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}//file.pdf`);
  assert.ok(err.includes("traversal") || err.includes("segment") || err.includes("does not resolve"));
});

// ─── Section 4: Percent-encoded traversal ────────────────────────────────────

test("Traversal encoded: %2e%2e (encoded ..) in filename is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/%2e%2e/secret.pdf`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

test("Traversal encoded: %2f (encoded /) in filename is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/sub%2f..%2fsecret.pdf`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

test("Traversal encoded: %252e (double-encoded .) is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/%252e%252e/secret.pdf`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

test("Traversal encoded: null byte %00 in filename is rejected", () => {
  const err = rejected(`storage://evidence/${PROJECT_A}/file%00.pdf`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

// ─── Section 5: Malformed UUIDs in canonical URIs ────────────────────────────

test("Malformed UUID: 'not-a-uuid' as project segment is rejected", () => {
  const err = rejected("storage://evidence/not-a-uuid/file.pdf");
  assert.ok(
    err.includes("malformed") || err.includes("does not resolve"),
    `Expected malformed-UUID error, got: ${err}`,
  );
});

test("Malformed UUID: too-short hex string is rejected", () => {
  const err = rejected("storage://evidence/1234-5678/file.pdf");
  assert.ok(err.includes("malformed") || err.includes("does not resolve"));
});

test("Malformed UUID: UUID with extra characters is rejected by regex (falls to unresolvable)", () => {
  // 37 characters — one too many — won't match EVIDENCE_STORAGE_REGEX.
  const tooLong = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa0";
  const err = rejected(`storage://evidence/${tooLong}/file.pdf`);
  assert.ok(err !== null);
});

// ─── Section 6: Relative paths — happy path ──────────────────────────────────

test("Relative path: bare filename (no slash) is prefixed with project ID", () => {
  const path = accepted("measurements.xlsx");
  assert.strictEqual(path, `${PROJECT_A}/measurements.xlsx`);
});

test("Relative path: <project-id>/<file> is accepted", () => {
  const path = accepted(`${PROJECT_A}/field_data.csv`);
  assert.strictEqual(path, `${PROJECT_A}/field_data.csv`);
});

test("Relative path: <project-id>/sub/dir/file.pdf is accepted", () => {
  const path = accepted(`${PROJECT_A}/sub/dir/file.pdf`);
  assert.strictEqual(path, `${PROJECT_A}/sub/dir/file.pdf`);
});

// ─── Section 7: Relative paths — cross-project ───────────────────────────────

test("Cross-project relative: <PROJECT_B>/file.pdf attached to Project A is rejected", () => {
  const err = rejected(`${PROJECT_B}/file.pdf`);
  assert.ok(err.includes("Cross-project evidence references are not permitted"));
  assert.ok(err.includes(PROJECT_B));
  assert.ok(err.includes(PROJECT_A));
});

test("Cross-project relative: multi-segment path with wrong prefix is rejected", () => {
  const err = rejected(`${PROJECT_B}/sub/folder/data.csv`);
  assert.ok(err.includes("Cross-project evidence references are not permitted"));
});

// ─── Section 8: Relative path traversal ──────────────────────────────────────

test("Traversal relative: <project-id>/../secret is rejected", () => {
  const err = rejected(`${PROJECT_A}/../secret`);
  assert.ok(err.includes("traversal") || err.includes("segment"));
});

test("Traversal relative: <project-id>/sub/../file.pdf is rejected", () => {
  const err = rejected(`${PROJECT_A}/sub/../file.pdf`);
  assert.ok(err.includes("traversal") || err.includes("segment"));
});

test("Traversal relative: encoded %2e%2e in relative path is rejected", () => {
  const err = rejected(`${PROJECT_A}/%2e%2e/file.pdf`);
  assert.ok(err.includes("traversal") || err.includes("does not resolve"));
});

// ─── Section 9: Disallowed URL schemes ───────────────────────────────────────

test("Scheme: HTTP URL is rejected", () => {
  const err = rejected(`https://cdn.example.com/${PROJECT_A}/evidence.pdf`);
  assert.ok(err.includes("unsupported external URL format"));
});

test("Scheme: FTP URL is rejected", () => {
  const err = rejected("ftp://storage.example.com/evidence.pdf");
  assert.ok(err.includes("unsupported external URL format"));
});

test("Scheme: data: URI is rejected", () => {
  const err = rejected("data:application/pdf;base64,JVBERi0xLj==");
  assert.ok(err.includes("unsupported external URL format"));
});

test("Scheme: javascript: URI is rejected", () => {
  const err = rejected("javascript:alert(1)");
  // No :// so it passes the scheme guard — it is a relative path whose first
  // segment "javascript:alert(1)" does not match the project UUID.
  assert.ok(err !== null, "Expected rejection for javascript: URI");
  assert.strictEqual(resolveEvidenceStoragePath("javascript:alert(1)", PROJECT_A, "e").storagePath, null);
});

test("Scheme: storage:// URI pointing to a different bucket is rejected", () => {
  const err = rejected(`storage://not-evidence/${PROJECT_A}/file.pdf`);
  assert.ok(err !== null);
});

// ─── Section 10: Missing / empty file_url ────────────────────────────────────

test("Empty: null-ish empty string is rejected", () => {
  const err = rejected("");
  assert.ok(err.includes("missing a valid file_url storage reference"));
});

test("Empty: whitespace-only string is rejected", () => {
  const err = rejected("   ");
  assert.ok(err.includes("missing a valid file_url storage reference"));
});

// ─── Section 11: Unresolvable URIs ───────────────────────────────────────────

test("Unresolvable: storage:// URI with empty filename segment is rejected", () => {
  // EVIDENCE_STORAGE_REGEX requires (.+) so trailing slash won't match.
  const r = resolveEvidenceStoragePath(
    `storage://evidence/${PROJECT_A}/`,
    PROJECT_A,
    "e",
  );
  assert.strictEqual(r.storagePath, null);
  assert.ok(r.error !== null);
});

// ─── Section 12: storagePath format invariants ───────────────────────────────

test("Format: resolved path is always <uuid>/<filename> with no leading slash", () => {
  const path = accepted(`storage://evidence/${PROJECT_A}/report.pdf`);
  assert.ok(!path.startsWith("/"), "storagePath must not have a leading slash");
  assert.ok(path.startsWith(PROJECT_A), "storagePath must start with the project UUID");
});

test("Format: resolved relative path is returned unchanged", () => {
  const path = accepted(`${PROJECT_A}/2026/data.csv`);
  assert.strictEqual(path, `${PROJECT_A}/2026/data.csv`);
});
