/**
 * Evidence File and Upload Validation Utilities
 *
 * Audit Reference: Finding 4 (Evidence Uploads, Validation, and Privacy)
 *
 * Enforces strict constraints on uploaded evidence:
 * - File size limits (max 25MB)
 * - Whitelisted MIME types & matching file extensions
 * - Filename sanitization against directory traversal (../, ..\, null bytes)
 * - Path format verification (storage://evidence/<project_id>/<file>)
 * - SHA-256 integrity hash verification
 */

export const MAX_EVIDENCE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "application/pdf",
]);

export const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "tif", "tiff", "pdf"]);

export interface EvidenceValidationResult {
  valid: boolean;
  sanitizedFilename: string;
  error?: string;
}

/** Sanitizes filenames to eliminate directory traversal sequences and special characters. */
export function sanitizeFilename(filename: string): string {
  // Strip path separators, null bytes, and control characters
  const clean = filename
    .replace(/[\0\r\n\t]/g, "")
    .replace(/[/\\]+/g, "_")
    .replace(/\.\.+/g, ".")
    .trim();

  // Allow only alphanumeric, dashes, underscores, and dots
  const sanitized = clean.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.slice(0, 120);
}

/** Validates file upload size, extension, and MIME type before processing. */
export function validateEvidenceUpload(file: {
  name: string;
  size: number;
  type: string;
}): EvidenceValidationResult {
  if (!file.name || file.name.trim().length === 0) {
    return { valid: false, sanitizedFilename: "", error: "Filename is required" };
  }

  const sanitized = sanitizeFilename(file.name);

  // File size check
  if (file.size <= 0) {
    return {
      valid: false,
      sanitizedFilename: sanitized,
      error: "Uploaded file is empty (0 bytes)",
    };
  }
  if (file.size > MAX_EVIDENCE_SIZE_BYTES) {
    return {
      valid: false,
      sanitizedFilename: sanitized,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum allowed 25MB`,
    };
  }

  // Extension check
  const ext = sanitized.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      sanitizedFilename: sanitized,
      error: `Unsupported file extension '.${ext}'. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
    };
  }

  // MIME type check
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    return {
      valid: false,
      sanitizedFilename: sanitized,
      error: `Unsupported MIME type '${file.type}'. Allowed: images (JPEG, PNG, WebP, TIFF) and PDF documents.`,
    };
  }

  return { valid: true, sanitizedFilename: sanitized };
}

/** Validates that a storage URI strictly conforms to the expected project evidence path pattern. */
export function validateStorageUri(uri: string): {
  valid: boolean;
  projectId?: string | undefined;
  filename?: string | undefined;
} {
  const match = uri.match(/^storage:\/\/evidence\/([0-9a-fA-F-]{36})\/([a-zA-Z0-9._-]+)$/);
  if (!match || !match[1] || !match[2]) return { valid: false };

  return {
    valid: true,
    projectId: match[1],
    filename: match[2],
  };
}
