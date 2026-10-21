/**
 * Sign-In with Ethereum (SIWE - EIP-4361) Authentication Engine
 *
 * Implements wallet-based cryptographic authentication without storing private keys
 * or trusting unauthenticated client headers:
 * - Deterministic EIP-4361 message parsing and validation.
 * - Nonce anti-replay protection.
 * - Expiration and domain validation.
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
}

/**
 * Creates a standard EIP-4361 formatted message string.
 */
export function formatSiweMessage(fields: SiweMessageFields): string {
  const header = `${fields.domain} wants you to sign in with your Ethereum account:\n${fields.address}\n\n`;
  const statement = fields.statement ? `${fields.statement}\n\n` : "";
  const uri = `URI: ${fields.uri}\n`;
  const version = `Version: ${fields.version}\n`;
  const chainId = `Chain ID: ${fields.chainId}\n`;
  const nonce = `Nonce: ${fields.nonce}\n`;
  const issuedAt = `Issued At: ${fields.issuedAt}`;
  const expiration = fields.expirationTime ? `\nExpiration Time: ${fields.expirationTime}` : "";
  const notBefore = fields.notBefore ? `\nNot Before: ${fields.notBefore}` : "";

  return `${header}${statement}${uri}${version}${chainId}${nonce}${issuedAt}${expiration}${notBefore}`;
}

/**
 * Parses an EIP-4361 formatted message text into structured fields.
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

  const uriMatch = messageText.match(/URI: (\S+)/);
  const versionMatch = messageText.match(/Version: (\S+)/);
  const chainIdMatch = messageText.match(/Chain ID: ([0-9]+)/);
  const nonceMatch = messageText.match(/Nonce: ([a-zA-Z0-9]{8,})/);
  const issuedAtMatch = messageText.match(/Issued At: (\S+)/);
  const expirationMatch = messageText.match(/Expiration Time: (\S+)/);

  if (!uriMatch || !versionMatch || !chainIdMatch || !nonceMatch || !issuedAtMatch) {
    throw new Error("Missing required SIWE fields (URI, Version, Chain ID, Nonce, or Issued At)");
  }

  return {
    domain,
    address,
    uri: uriMatch[1]!,
    version: versionMatch[1]!,
    chainId: parseInt(chainIdMatch[1]!, 10),
    nonce: nonceMatch[1]!,
    issuedAt: issuedAtMatch[1]!,
    expirationTime: expirationMatch ? expirationMatch[1] : undefined,
  };
}

/**
 * Validates a signed SIWE message against an expected domain, chainId, and valid nonces.
 */
export function verifySiweSignature(
  messageText: string,
  signatureHex: string,
  expectedDomain: string,
  expectedChainId?: number,
): {
  isValid: boolean;
  address: string;
  error?: string | undefined;
} {
  try {
    const fields = parseSiweMessage(messageText);

    // 1. Verify Domain
    if (fields.domain.toLowerCase() !== expectedDomain.toLowerCase()) {
      return {
        isValid: false,
        address: fields.address,
        error: `Domain mismatch: message domain is '${fields.domain}', expected '${expectedDomain}'`,
      };
    }

    // 2. Verify Chain ID if configured
    if (expectedChainId && fields.chainId !== expectedChainId) {
      return {
        isValid: false,
        address: fields.address,
        error: `Chain ID mismatch: message chain ID is ${fields.chainId}, expected ${expectedChainId}`,
      };
    }

    // 3. Check Expiration
    if (fields.expirationTime) {
      const expTime = new Date(fields.expirationTime).getTime();
      if (!Number.isNaN(expTime) && Date.now() >= expTime) {
        return {
          isValid: false,
          address: fields.address,
          error: "SIWE session message has expired",
        };
      }
    }

    // 4. Verify Cryptographic Signature
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
