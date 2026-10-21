/**
 * evidence-storage-path.ts
 *
 * Canonical storage URI parser and project-ownership validator for evidence files.
 *
 * This module is the single source of truth for storage path resolution.
 * Both approveProject() and its tests import this function directly so
 * production logic and test coverage can never silently diverge.
 *
 * Security properties enforced:
 *   1. Only the storage:// scheme is accepted; all external schemes are rejected.
 *   2. The project UUID embedded in a storage:// URI must match the project
 *      currently under approval (cross-project reference rejection).
 *   3. Relative paths are accepted only when their first segment is the
 *      approved project's UUID.
 *   4. Path-traversal sequences (., .., empty segments, null bytes) are
 *      rejected in every position — both in canonical URIs and relative paths.
 *   5. Percent-encoded variants of traversal sequences are rejected before
 *      any decoding so a double-encode cannot bypass the raw-string check.
 *   6. Malformed UUIDs (wrong length, wrong format) are rejected explicitly.
 *
 * Audit Reference: P1 — Evidence storage paths must be bound to the approved
 * project; path traversal must be rejected and paths must be normalized before
 * use.
 */

/** Canonical storage URI format: storage://evidence/<project-uuid>/<filename> */
export const EVIDENCE_STORAGE_REGEX =
  /^storage:\/\/evidence\/([0-9a-fA-F-]{36})\/(.+)$/;

/**
 * RFC 4122 UUID shape — 8-4-4-4-12 hex groups separated by hyphens.
 * Exactly 36 characters (32 hex + 4 hyphens).
 */
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Returned by resolveEvidenceStoragePath. */
export interface StoragePathResult {
  /** Resolved `<projectId>/<filename>` path ready for storage.from('evidence').download(), or null on error. */
  storagePath: string | null;
  /** Human-readable rejection reason, or null on success. Caller should prefix with context ("Verification approval rejected: …"). */
  error: string | null;
}

/**
 * Returns true if `raw` contains a path-traversal sequence, either as a
 * literal segment or as a percent-encoded variant.
 *
 * Checks are applied to the raw string first (catches encoded traversal before
 * decoding) and then to the decoded string (catches literal .. and . segments).
 */
function containsTraversal(raw: string): boolean {
  // ── Raw-string checks (encoded traversal, null bytes) ────────────────────
  const lower = raw.toLowerCase();

  const encodedPatterns = [
    "%2e%2e", // %2e%2e → ..
    "%2e.",   // %2e.  → ..
    ".%2e",   // .%2e  → ..
    "%2f",    // %2f   → /
    "%5c",    // %5c   → \
    "%00",    // %00   → NUL
    "%252e",  // %252e → double-encoded .
    "%252f",  // %252f → double-encoded /
    "%255c",  // %255c → double-encoded \
  ];

  for (const pattern of encodedPatterns) {
    if (lower.includes(pattern)) return true;
  }

  // Literal null byte
  if (raw.includes("\0")) return true;

  // ── Decoded-string checks (literal . and .. segments) ────────────────────
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent encoding — treat as unsafe.
    return true;
  }

  // Split on both / and \ so Windows-style separators are also caught.
  const segments = decoded.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === ".." || seg === ".") return true;
  }

  return false;
}

/**
 * Resolves and validates a file_url against the project currently being approved.
 *
 * @param fileUrl     The raw value from the evidence.file_url database column.
 * @param projectId   The UUID of the project currently under approval.
 * @param evidenceName  Display name for the evidence record (used in error messages).
 * @returns StoragePathResult — either `{ storagePath, error: null }` on success
 *          or `{ storagePath: null, error: <reason> }` on rejection.
 */
export function resolveEvidenceStoragePath(
  fileUrl: string,
  projectId: string,
  evidenceName: string,
): StoragePathResult {
  function reject(reason: string): StoragePathResult {
    return { storagePath: null, error: reason };
  }
  function accept(storagePath: string): StoragePathResult {
    return { storagePath, error: null };
  }

  // ── 1. Presence check ────────────────────────────────────────────────────
  if (!fileUrl || typeof fileUrl !== "string" || fileUrl.trim() === "") {
    return reject(
      `Evidence record "${evidenceName}" is missing a valid file_url storage reference.`,
    );
  }

  const trimmed = fileUrl.trim();

  // ── 2. Scheme allow-list ─────────────────────────────────────────────────
  // Only storage:// is accepted. http://, https://, ftp://, data:, and every
  // other scheme is rejected explicitly.
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) &&
      !trimmed.startsWith("storage://"))
  ) {
    return reject(
      `Evidence record "${evidenceName}" references an unsupported external URL format ("${trimmed}"). Evidence must reside in approved object storage.`,
    );
  }

  // ── 3. Canonical storage:// URI ──────────────────────────────────────────
  if (trimmed.startsWith("storage://evidence/")) {
    // 3a. Reject traversal in the raw URI before any parsing.
    //     Apply the check to the portion after the scheme+bucket prefix so
    //     legitimate UUID hyphens are not tripped by the encoded-dot check.
    const afterScheme = trimmed.slice("storage://evidence/".length);
    if (containsTraversal(afterScheme)) {
      return reject(
        `Evidence record "${evidenceName}" contains path traversal sequences in its storage URI ("${trimmed}").`,
      );
    }

    // 3b. Parse into projectId + filename.
    const match = trimmed.match(EVIDENCE_STORAGE_REGEX);
    if (!match || !match[1] || !match[2]) {
      return reject(
        `Evidence record "${evidenceName}" does not resolve to a valid storage object path ("${trimmed}").`,
      );
    }

    const embeddedProjectId = match[1]!;
    const filename = match[2]!;

    // 3c. Validate the UUID format (must be a proper RFC 4122 shape).
    if (!UUID_REGEX.test(embeddedProjectId)) {
      return reject(
        `Evidence record "${evidenceName}" contains a malformed project UUID in its storage URI ("${embeddedProjectId}").`,
      );
    }

    // 3d. SECURITY: ownership binding — embedded UUID must match the approved project.
    if (embeddedProjectId !== projectId) {
      return reject(
        `Evidence record "${evidenceName}" references storage path belonging to project "${embeddedProjectId}" but is attached to project "${projectId}". Cross-project evidence references are not permitted.`,
      );
    }

    // 3e. Traverse-check on the filename segment.
    if (containsTraversal(filename)) {
      return reject(
        `Evidence record "${evidenceName}" contains path traversal sequences in its storage filename ("${filename}").`,
      );
    }

    // 3f. Split filename on / and verify no empty or dot segments remain.
    const filenameSegments = filename.split("/");
    for (const seg of filenameSegments) {
      if (seg === "" || seg === "." || seg === "..") {
        return reject(
          `Evidence record "${evidenceName}" contains an empty or traversal segment in its storage filename ("${filename}").`,
        );
      }
    }

    return accept(`${embeddedProjectId}/${filename}`);
  }

  // ── 4. Relative path (no scheme) ─────────────────────────────────────────
  if (!trimmed.includes("://")) {
    // 4a. Reject traversal in the raw relative path before splitting.
    if (containsTraversal(trimmed)) {
      return reject(
        `Evidence record "${evidenceName}" contains path traversal sequences in its relative storage path ("${trimmed}").`,
      );
    }

    if (trimmed.includes("/")) {
      // Slashed relative path: <projectId>/<filename>
      const segments = trimmed.split("/");
      const firstSegment = segments[0]!;

      // 4b. SECURITY: ownership binding on the first segment.
      if (firstSegment !== projectId) {
        return reject(
          `Evidence record "${evidenceName}" uses a relative storage path ("${trimmed}") whose prefix "${firstSegment}" does not match the current project ID "${projectId}". Cross-project evidence references are not permitted.`,
        );
      }

      // 4c. Validate UUID format of the first segment.
      if (!UUID_REGEX.test(firstSegment)) {
        return reject(
          `Evidence record "${evidenceName}" contains a malformed project UUID prefix in its relative storage path ("${firstSegment}").`,
        );
      }

      // 4d. Validate each remaining segment for traversal / emptiness.
      const remainingSegments = segments.slice(1);
      for (const seg of remainingSegments) {
        if (seg === "" || seg === "." || seg === "..") {
          return reject(
            `Evidence record "${evidenceName}" contains an empty or traversal path segment in its relative storage path ("${trimmed}").`,
          );
        }
      }

      return accept(trimmed);
    } else {
      // Bare filename — safe to prefix with the current project ID.
      // Reject null bytes, backslashes, and colons. A colon in a bare name
      // indicates a scheme-like string (e.g. "javascript:…") that passed
      // the ://  guard because it has no double-slash.
      if (trimmed.includes("\\") || trimmed.includes("\0") || trimmed.includes(":")) {
        return reject(
          `Evidence record "${evidenceName}" contains unsafe characters in its storage filename ("${trimmed}").`,
        );
      }

      return accept(`${projectId}/${trimmed}`);
    }
  }

  // ── 5. Unrecognised format ────────────────────────────────────────────────
  return reject(
    `Evidence record "${evidenceName}" does not resolve to a valid storage object path ("${trimmed}").`,
  );
}
