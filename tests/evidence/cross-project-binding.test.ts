/**
 * Cross-Project Evidence Path Binding Tests
 *
 * Audit Reference: P1 — Evidence storage paths are not bound to the project being approved.
 *
 * These tests exercise the path-resolution and project-binding logic extracted
 * directly from approveProject() in src/lib/registry.server.ts.
 * They run without a live Supabase connection.
 *
 * Attack scenario: an adversary manipulates an evidence record's file_url so
 * that approval for Project A downloads and hashes an object belonging to
 * Project B — where Project B happens to have a matching hash. If the check
 * were absent, the approval would succeed with fabricated provenance.
 */

import test from "node:test";
import assert from "node:assert";

// ---------------------------------------------------------------------------
// Inline replica of the path-binding logic from approveProject()
// This MUST be kept in sync with the production implementation.
// ---------------------------------------------------------------------------
const EVIDENCE_STORAGE_REGEX = /^storage:\/\/evidence\/([0-9a-fA-F-]{36})\/(.+)$/;

interface StoragePathResult {
  storagePath: string | null;
  error: string | null;
}

/**
 * Resolves and validates a file_url string against a given owning project ID.
 * Returns an error string for any cross-project reference or unrecognised URL scheme.
 * This mirrors the exact logic in the production evidence loop.
 */
function resolveEvidenceStoragePath(
  fileUrl: string,
  projectId: string,
  evidenceName: string,
): StoragePathResult {
  if (!fileUrl || typeof fileUrl !== "string" || fileUrl.trim() === "") {
    return {
      storagePath: null,
      error: `Evidence record "${evidenceName}" is missing a valid file_url storage reference.`,
    };
  }

  const trimmed = fileUrl.trim();

  // Reject HTTP/HTTPS, data: and arbitrary external URL schemes
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && !trimmed.startsWith("storage://"))
  ) {
    return {
      storagePath: null,
      error: `Evidence record "${evidenceName}" references an unsupported external URL format ("${trimmed}"). Evidence must reside in approved object storage.`,
    };
  }

  let storagePath: string | null = null;

  if (trimmed.startsWith("storage://evidence/")) {
    const match = trimmed.match(EVIDENCE_STORAGE_REGEX);
    if (match && match[1] && match[2]) {
      const embeddedProjectId = match[1];
      // SECURITY: the embedded project ID MUST match the project being approved.
      if (embeddedProjectId !== projectId) {
        return {
          storagePath: null,
          error:
            `Evidence record "${evidenceName}" references storage path ` +
            `belonging to project "${embeddedProjectId}" but is attached to project "${projectId}". ` +
            `Cross-project evidence references are not permitted.`,
        };
      }
      storagePath = `${embeddedProjectId}/${match[2]}`;
    }
  } else if (!trimmed.includes("://")) {
    if (trimmed.includes("/")) {
      const firstSegment = trimmed.split("/")[0];
      // SECURITY: reject relative paths whose first segment is not the
      // current project ID.
      if (firstSegment !== projectId) {
        return {
          storagePath: null,
          error:
            `Evidence record "${evidenceName}" uses a relative storage path ` +
            `("${trimmed}") whose prefix "${firstSegment}" does not match the current project ID ` +
            `"${projectId}". Cross-project evidence references are not permitted.`,
        };
      }
      storagePath = trimmed;
    } else {
      // Bare filename — safe to prefix with the current project ID.
      storagePath = `${projectId}/${trimmed}`;
    }
  }

  if (!storagePath) {
    return {
      storagePath: null,
      error: `Evidence record "${evidenceName}" does not resolve to a valid storage object path ("${trimmed}").`,
    };
  }

  return { storagePath, error: null };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_FILE = "baseline_report.pdf";

// ---------------------------------------------------------------------------
// Tests: canonical storage:// URIs
// ---------------------------------------------------------------------------

test("Cross-project binding: valid storage:// URI belonging to the approved project is accepted", () => {
  const url = `storage://evidence/${PROJECT_A}/${VALID_FILE}`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "baseline_report");

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.storagePath, `${PROJECT_A}/${VALID_FILE}`);
});

test("Cross-project binding: storage:// URI referencing a DIFFERENT project is rejected", () => {
  // Adversary crafts a file_url that embeds Project B's UUID but attaches
  // it to Project A's evidence record.
  const url = `storage://evidence/${PROJECT_B}/${VALID_FILE}`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "manipulated_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(
    result.error?.includes("Cross-project evidence references are not permitted"),
    `Expected cross-project error but got: ${result.error}`,
  );
  assert.ok(
    result.error?.includes(PROJECT_B),
    `Error should identify the offending project ID. Got: ${result.error}`,
  );
  assert.ok(
    result.error?.includes(PROJECT_A),
    `Error should identify the approved project ID. Got: ${result.error}`,
  );
});

test("Cross-project binding: storage:// URI with arbitrary UUID in path is rejected", () => {
  const foreignId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const url = `storage://evidence/${foreignId}/sensitive_data.pdf`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "sensitive_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("Cross-project evidence references are not permitted"));
});

// ---------------------------------------------------------------------------
// Tests: relative path URIs
// ---------------------------------------------------------------------------

test("Cross-project binding: bare filename (no slash) is safely prefixed with current project ID", () => {
  const url = "field_measurements.xlsx";
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "measurements");

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.storagePath, `${PROJECT_A}/field_measurements.xlsx`);
});

test("Cross-project binding: relative path already starting with the correct project ID is accepted", () => {
  const url = `${PROJECT_A}/field_measurements.xlsx`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "measurements");

  assert.strictEqual(result.error, null);
  assert.strictEqual(result.storagePath, `${PROJECT_A}/field_measurements.xlsx`);
});

test("Cross-project binding: relative path starting with a DIFFERENT project UUID is rejected", () => {
  // Adversary uses a relative path whose first segment is Project B's UUID.
  const url = `${PROJECT_B}/attacker_controlled.pdf`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "attacker_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(
    result.error?.includes("Cross-project evidence references are not permitted"),
    `Expected cross-project rejection. Got: ${result.error}`,
  );
  assert.ok(result.error?.includes(PROJECT_B));
  assert.ok(result.error?.includes(PROJECT_A));
});

test("Cross-project binding: multi-segment relative path with wrong prefix is rejected", () => {
  const url = `${PROJECT_B}/sub/folder/data.csv`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "nested_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("Cross-project evidence references are not permitted"));
});

// ---------------------------------------------------------------------------
// Tests: disallowed URL schemes
// ---------------------------------------------------------------------------

test("Cross-project binding: HTTP URL is rejected regardless of project match", () => {
  const url = `https://cdn.example.com/${PROJECT_A}/evidence.pdf`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "remote_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(
    result.error?.includes("unsupported external URL format"),
    `Expected external URL rejection. Got: ${result.error}`,
  );
});

test("Cross-project binding: FTP URL is rejected", () => {
  const url = "ftp://storage.example.com/evidence.pdf";
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "ftp_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("unsupported external URL format"));
});

test("Cross-project binding: data: URI is rejected", () => {
  const url = "data:application/pdf;base64,JVBERi0xLj==";
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "data_uri_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("unsupported external URL format"));
});

// ---------------------------------------------------------------------------
// Tests: missing / empty file_url
// ---------------------------------------------------------------------------

test("Cross-project binding: empty file_url is rejected", () => {
  const result = resolveEvidenceStoragePath("", PROJECT_A, "empty_url_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("missing a valid file_url storage reference"));
});

test("Cross-project binding: whitespace-only file_url is rejected", () => {
  const result = resolveEvidenceStoragePath("   ", PROJECT_A, "whitespace_evidence");

  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error?.includes("missing a valid file_url storage reference"));
});

// ---------------------------------------------------------------------------
// Tests: unresolvable URIs
// ---------------------------------------------------------------------------

test("Cross-project binding: storage:// URI with no filename segment does not resolve", () => {
  // Malformed — the regex requires a non-empty filename after the UUID.
  const url = `storage://evidence/${PROJECT_A}/`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "no_filename_evidence");

  // Either rejected by EVIDENCE_STORAGE_REGEX (storagePath stays null) or
  // accepted with a trailing slash — the important thing is no cross-project bypass.
  // The production regex requires (.+) so the trailing-slash variant won't match.
  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error !== null);
});

test("Cross-project binding: storage://wrong-bucket/... is rejected as unresolvable", () => {
  const url = `storage://not-evidence/${PROJECT_A}/file.pdf`;
  const result = resolveEvidenceStoragePath(url, PROJECT_A, "wrong_bucket");

  // The URL contains "://" but doesn't start with "storage://evidence/" —
  // it matches the external-scheme guard and is rejected.
  assert.strictEqual(result.storagePath, null);
  assert.ok(result.error !== null);
});
