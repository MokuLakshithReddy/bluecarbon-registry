/**
 * Immutable Decentralized Storage Anchoring (IPFS & Arweave)
 *
 * Implements strict format validation and gateway resolution for
 * MRV evidence packs (GeoTIFF rasters, LiDAR point clouds, soil lab reports).
 *
 * Supports:
 * - IPFS (CIDv0 Qm... and CIDv1 bafy...)
 * - Arweave (43-character base64url transaction IDs)
 */

export type DecentralizedProtocol = "ipfs" | "arweave";

export interface ParsedStorageUri {
  protocol: DecentralizedProtocol;
  identifier: string; // CID or Arweave Tx ID
  path?: string | undefined;
  canonicalUri: string;
}

// IPFS CIDv0: 46 characters starting with Qm (base58btc)
const IPFS_CIDV0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
// IPFS CIDv1: Typically starts with bafy or bafk (base32 or base36, 50-90 chars)
const IPFS_CIDV1_REGEX = /^baf[a-zA-Z0-9]{50,90}$/;
// Arweave Tx ID: 43 characters base64url ([a-zA-Z0-9_-]{43})
const ARWEAVE_TX_REGEX = /^[a-zA-Z0-9_-]{43}$/;

export const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
];

export const DEFAULT_ARWEAVE_GATEWAYS = ["https://arweave.net/", "https://ar-io.net/"];

/**
 * Validates and parses an IPFS or Arweave storage URI.
 * Rejects arbitrary external web links (e.g. http://, ftp://).
 */
export function parseDecentralizedUri(uri: string): ParsedStorageUri {
  if (!uri || typeof uri !== "string") {
    throw new Error("Storage URI must be a non-empty string");
  }

  const trimmed = uri.trim();

  if (trimmed.startsWith("ipfs://")) {
    const rawPath = trimmed.slice("ipfs://".length);
    const [cid, ...subpathParts] = rawPath.split("/");
    const subpath = subpathParts.length > 0 ? subpathParts.join("/") : undefined;

    if (!cid || (!IPFS_CIDV0_REGEX.test(cid) && !IPFS_CIDV1_REGEX.test(cid))) {
      throw new Error(`Invalid IPFS Content Identifier (CID): '${cid}'`);
    }

    return {
      protocol: "ipfs",
      identifier: cid,
      path: subpath,
      canonicalUri: subpath ? `ipfs://${cid}/${subpath}` : `ipfs://${cid}`,
    };
  }

  if (trimmed.startsWith("ar://")) {
    const rawPath = trimmed.slice("ar://".length);
    const [txId, ...subpathParts] = rawPath.split("/");
    const subpath = subpathParts.length > 0 ? subpathParts.join("/") : undefined;

    if (!txId || !ARWEAVE_TX_REGEX.test(txId)) {
      throw new Error(`Invalid Arweave transaction identifier: '${txId}'`);
    }

    return {
      protocol: "arweave",
      identifier: txId,
      path: subpath,
      canonicalUri: subpath ? `ar://${txId}/${subpath}` : `ar://${txId}`,
    };
  }

  throw new Error(
    `Unsupported decentralized storage URI scheme. Must start with ipfs:// or ar://, got: '${trimmed}'`,
  );
}

/**
 * Resolves a decentralized storage URI to an array of prioritized HTTP gateway URLs for resilient fetching.
 */
export function resolveGatewayUrls(uri: string): string[] {
  const parsed = parseDecentralizedUri(uri);

  if (parsed.protocol === "ipfs") {
    const suffix = parsed.path ? `${parsed.identifier}/${parsed.path}` : parsed.identifier;
    return DEFAULT_IPFS_GATEWAYS.map((gw) => `${gw}${suffix}`);
  }

  if (parsed.protocol === "arweave") {
    const suffix = parsed.path ? `${parsed.identifier}/${parsed.path}` : parsed.identifier;
    return DEFAULT_ARWEAVE_GATEWAYS.map((gw) => `${gw}${suffix}`);
  }

  return [];
}

/**
 * Generates an immutable MRV Verification Package manifest.
 */
export interface VerificationEvidencePackManifest {
  projectId: string;
  vintageYear: number;
  methodology: string;
  geoTiffRasterUri: string; // ipfs://...
  multispectralNdviUri: string; // ipfs://...
  soilCoreLabReportUri: string; // ar://... or ipfs://...
  auditorSignoffUri: string; // ar://...
  createdAt: string;
}

export function validateEvidencePackManifest(manifest: VerificationEvidencePackManifest): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    parseDecentralizedUri(manifest.geoTiffRasterUri);
  } catch (err) {
    errors.push(`GeoTIFF: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    parseDecentralizedUri(manifest.multispectralNdviUri);
  } catch (err) {
    errors.push(`Multispectral NDVI: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    parseDecentralizedUri(manifest.soilCoreLabReportUri);
  } catch (err) {
    errors.push(`Soil Lab Report: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    parseDecentralizedUri(manifest.auditorSignoffUri);
  } catch (err) {
    errors.push(`Auditor Signoff: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
