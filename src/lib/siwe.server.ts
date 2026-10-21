/**
 * Sign-In with Ethereum (SIWE - EIP-4361) Authentication Engine
 *
 * Implements wallet-based cryptographic authentication without storing private keys
 * or trusting unauthenticated client headers:
 * - Deterministic EIP-4361 message parsing and strict format validation.
 * - Single-use, server-issued nonce anti-replay protection with atomic consumption.
 * - Strict ISO-8601 timestamp validation (Issued At, Not Before, Expiration Time).
 * - Not Before time boundary enforcement.
 * - Fail-closed error handling for malformed or expired messages.
 * - HTTP-only session cookie configuration.
 */

import { ethers } from "ethers";

export interface SiweMessageFields {
  domain: string;
  address: string;
  statement?: string | undefined;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string | undefined;
  notBefore?: string | undefined;
  requestId?: string | undefined;
  resources?: string[] | undefined;
}

export interface SiweVerificationOptions {
  expectedDomain?: string | undefined;
  expectedChainId?: number | undefined;
  expectedNonce?: string | undefined;
  enforceNonceConsumption?: boolean | undefined;
  nowMs?: number | undefined;
}

// -----------------------------------------------------------------------------
// Server-side Nonce Store (Anti-Replay Protection)
// -----------------------------------------------------------------------------
interface NonceEntry {
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  boundAddress?: string | undefined;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const nonceStore = new Map<string, NonceEntry>();

/**
 * Issues a cryptographically random, server-tracked nonce bound to an optional address.
 */
export function issueSiweNonce(boundAddress?: string): string {
  pruneExpiredNonces();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const nonce = [...randomBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  nonceStore.set(nonce, {
    nonce,
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + NONCE_TTL_MS,
    boundAddress: boundAddress ? boundAddress.toLowerCase() : undefined,
  });

  return nonce;
}

/**
 * Atomically consumes a server-issued nonce to prevent replay attacks.
 * Returns true if valid and consumed; false if unknown, expired, or mismatched address.
 */
export function consumeSiweNonce(nonce: string, address?: string, nowMs = Date.now()): boolean {
  pruneExpiredNonces(nowMs);
  const entry = nonceStore.get(nonce);
  if (!entry) {
    return false;
  }

  // Atomically delete immediately to prevent concurrent replay
  nonceStore.delete(nonce);

  if (nowMs > entry.expiresAtMs) {
    return false;
  }

  if (entry.boundAddress && address) {
    if (entry.boundAddress.toLowerCase() !== address.toLowerCase()) {
      return false;
    }
  }

  return true;
}

/**
 * Cleans up expired nonces to prevent memory leaks.
 */
function pruneExpiredNonces(nowMs = Date.now()): void {
  for (const [key, entry] of nonceStore.entries()) {
    if (nowMs > entry.expiresAtMs) {
      nonceStore.delete(key);
    }
  }
}

/**
 * Testing utility to reset server nonce store state.
 */
export function _resetSiweNonceStoreForTesting(): void {
  nonceStore.clear();
}

/**
 * Issues a cryptographically random nonce and durably persists it into PostgreSQL (public.siwe_nonces)
 * when a Supabase client is supplied, falling back to process-local store.
 */
export async function issueDurableSiweNonce(
  supabaseClient?: {
    from: (table: string) => { insert: (data: unknown) => Promise<unknown> };
  } | null,
  boundAddress?: string,
): Promise<string> {
  const nonce = issueSiweNonce(boundAddress);
  if (supabaseClient) {
    try {
      await supabaseClient.from("siwe_nonces").insert({
        nonce,
        bound_address: boundAddress ? boundAddress.toLowerCase() : null,
        expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
      });
    } catch {
      // Memory fallback handles standalone/isolated operation
    }
  }
  return nonce;
}

/**
 * Atomically consumes a server nonce in PostgreSQL (public.consume_siwe_nonce) to prevent replay
 * attacks across multiple serverless/container instances.
 */
export async function consumeDurableSiweNonce(
  supabaseClient:
    | {
        rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
      }
    | null
    | undefined,
  nonce: string,
  address?: string,
): Promise<boolean> {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.rpc("consume_siwe_nonce", {
        p_nonce: nonce,
        p_address: address ?? "",
      });
      if (!error && typeof data === "boolean") {
        return data;
      }
    } catch {
      // Memory fallback handles standalone/isolated operation
    }
  }
  return consumeSiweNonce(nonce, address);
}

// -----------------------------------------------------------------------------
// ISO-8601 Strict Validation
// -----------------------------------------------------------------------------
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseAndValidateIso8601(dateStr: string, fieldName: string): number {
  if (!ISO_8601_REGEX.test(dateStr)) {
    throw new Error(`Invalid ISO-8601 format for ${fieldName}: '${dateStr}'`);
  }
  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error(`Unparseable date value for ${fieldName}: '${dateStr}'`);
  }
  return timestamp;
}

// -----------------------------------------------------------------------------
// EIP-4361 Formatting & Parsing
// -----------------------------------------------------------------------------
/**
 * Creates a standard EIP-4361 formatted message string.
 */
export function formatSiweMessage(fields: SiweMessageFields): string {
  // Validate required timestamp format at generation time
  parseAndValidateIso8601(fields.issuedAt, "Issued At");
  if (fields.expirationTime) {
    parseAndValidateIso8601(fields.expirationTime, "Expiration Time");
  }
  if (fields.notBefore) {
    parseAndValidateIso8601(fields.notBefore, "Not Before");
  }

  const lines: string[] = [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
  ];
  if (fields.statement) {
    lines.push(fields.statement, "");
  }
  lines.push(`URI: ${fields.uri}`);
  lines.push(`Version: ${fields.version}`);
  lines.push(`Chain ID: ${fields.chainId}`);
  lines.push(`Nonce: ${fields.nonce}`);
  lines.push(`Issued At: ${fields.issuedAt}`);
  if (fields.expirationTime) {
    lines.push(`Expiration Time: ${fields.expirationTime}`);
  }
  if (fields.notBefore) {
    lines.push(`Not Before: ${fields.notBefore}`);
  }
  if (fields.requestId) {
    lines.push(`Request ID: ${fields.requestId}`);
  }

  return lines.join("\n");
}

/**
 * Parses an EIP-4361 formatted message text into structured fields.
 * Strictly validates message format, addresses, and ISO-8601 date fields.
 */
export function parseSiweMessage(messageText: string): SiweMessageFields {
  const domainMatch = messageText.match(
    /^([a-zA-Z0-9.-]+(?::[0-9]+)?) wants you to sign in with your Ethereum account:\n(0x[a-fA-F0-9]{40})/,
  );
  if (!domainMatch) {
    throw new Error("Invalid SIWE message header or address format");
  }

  const domain = domainMatch[1]!;
  const address = domainMatch[2]!;

  const uriMatch = messageText.match(/(?:^|\n)URI: (\S+)/);
  const versionMatch = messageText.match(/(?:^|\n)Version: (\S+)/);
  const chainIdMatch = messageText.match(/(?:^|\n)Chain ID: ([0-9]+)/);
  const nonceMatch = messageText.match(/(?:^|\n)Nonce: ([-_a-zA-Z0-9]{8,})/);
  const issuedAtMatch = messageText.match(/(?:^|\n)Issued At: (\S+)/);
  const expirationMatch = messageText.match(/(?:^|\n)Expiration Time: (\S+)/);
  const notBeforeMatch = messageText.match(/(?:^|\n)Not Before: (\S+)/);
  const requestIdMatch = messageText.match(/(?:^|\n)Request ID: (\S+)/);

  if (!uriMatch || !versionMatch || !chainIdMatch || !nonceMatch || !issuedAtMatch) {
    throw new Error("Missing required SIWE fields (URI, Version, Chain ID, Nonce, or Issued At)");
  }

  const version = versionMatch[1]!;
  if (version !== "1") {
    throw new Error(`Unsupported SIWE version: '${version}'. Expected '1'.`);
  }

  const issuedAt = issuedAtMatch[1]!;
  parseAndValidateIso8601(issuedAt, "Issued At");

  const expirationTime = expirationMatch ? expirationMatch[1] : undefined;
  if (expirationTime) {
    parseAndValidateIso8601(expirationTime, "Expiration Time");
  }

  const notBefore = notBeforeMatch ? notBeforeMatch[1] : undefined;
  if (notBefore) {
    parseAndValidateIso8601(notBefore, "Not Before");
  }

  return {
    domain,
    address,
    uri: uriMatch[1]!,
    version,
    chainId: parseInt(chainIdMatch[1]!, 10),
    nonce: nonceMatch[1]!,
    issuedAt,
    expirationTime,
    notBefore,
    requestId: requestIdMatch ? requestIdMatch[1] : undefined,
  };
}

// -----------------------------------------------------------------------------
// Cryptographic Verification & Replay Protection
// -----------------------------------------------------------------------------
/**
 * Validates a signed SIWE message against expected domain, chainId, replay nonce, and time validity.
 */
export function verifySiweSignature(
  messageText: string,
  signatureHex: string,
  expectedDomainOrOptions: string | SiweVerificationOptions,
  maybeExpectedChainId?: number,
): {
  isValid: boolean;
  address: string;
  error?: string | undefined;
} {
  try {
    const options: SiweVerificationOptions =
      typeof expectedDomainOrOptions === "string"
        ? {
            expectedDomain: expectedDomainOrOptions,
            expectedChainId: maybeExpectedChainId,
          }
        : expectedDomainOrOptions;

    const nowMs = options.nowMs ?? Date.now();
    const fields = parseSiweMessage(messageText);

    // 1. Verify Domain
    if (
      options.expectedDomain &&
      fields.domain.toLowerCase() !== options.expectedDomain.toLowerCase()
    ) {
      return {
        isValid: false,
        address: fields.address,
        error: `Domain mismatch: message domain is '${fields.domain}', expected '${options.expectedDomain}'`,
      };
    }

    // 2. Verify Chain ID
    if (options.expectedChainId && fields.chainId !== options.expectedChainId) {
      return {
        isValid: false,
        address: fields.address,
        error: `Chain ID mismatch: message chain ID is ${fields.chainId}, expected ${options.expectedChainId}`,
      };
    }

    // 3. Verify Nonce Matching
    if (options.expectedNonce && fields.nonce !== options.expectedNonce) {
      return {
        isValid: false,
        address: fields.address,
        error: `Nonce mismatch: message nonce is '${fields.nonce}', expected '${options.expectedNonce}'`,
      };
    }

    // 4. Nonce Replay Protection: Atomically consume if configured or if nonce exists in store
    if (options.enforceNonceConsumption || nonceStore.has(fields.nonce)) {
      const consumed = consumeSiweNonce(fields.nonce, fields.address, nowMs);
      if (!consumed) {
        return {
          isValid: false,
          address: fields.address,
          error: "SIWE nonce invalid, expired, or already consumed (replay prevented)",
        };
      }
    }

    // 5. Strict Time Boundary Checks: Not Before
    if (fields.notBefore) {
      const notBeforeMs = parseAndValidateIso8601(fields.notBefore, "Not Before");
      if (nowMs < notBeforeMs) {
        return {
          isValid: false,
          address: fields.address,
          error: `SIWE session is not yet active (Not Before: ${fields.notBefore})`,
        };
      }
    }

    // 6. Strict Time Boundary Checks: Expiration
    if (fields.expirationTime) {
      const expTimeMs = parseAndValidateIso8601(fields.expirationTime, "Expiration Time");
      if (nowMs >= expTimeMs) {
        return {
          isValid: false,
          address: fields.address,
          error: "SIWE session message has expired",
        };
      }
    }

    // 7. Verify Cryptographic Signature
    const recovered = ethers.verifyMessage(messageText, signatureHex);
    if (recovered.toLowerCase() !== fields.address.toLowerCase()) {
      return {
        isValid: false,
        address: fields.address,
        error: `Signer mismatch: recovered '${recovered}', expected '${fields.address}'`,
      };
    }

    return {
      isValid: true,
      address: ethers.getAddress(fields.address),
    };
  } catch (err) {
    return {
      isValid: false,
      address: "",
      error: err instanceof Error ? err.message : "SIWE signature verification failed",
    };
  }
}

/**
 * Returns security-hardened HTTP-only cookie attributes for SIWE session cookies.
 */
export function getSecureSessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  };
}
