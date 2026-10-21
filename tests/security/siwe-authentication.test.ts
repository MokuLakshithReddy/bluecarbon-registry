import test from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import {
  formatSiweMessage,
  parseSiweMessage,
  verifySiweSignature,
  getSecureSessionCookieOptions,
  type SiweMessageFields,
} from "../../src/lib/siwe.server.ts";

test("SIWE Authentication: Formats, signs, and cryptographically verifies EIP-4361 messages", async () => {
  const wallet = ethers.Wallet.createRandom();
  const domain = "registry.bluecarbon.gov.in";
  const chainId = 80002; // Polygon Amoy Testnet

  const fields: SiweMessageFields = {
    domain,
    address: wallet.address,
    statement: "Sign in with Ethereum to the BlueCarbon MRV Registry.",
    uri: "https://registry.bluecarbon.gov.in/auth/siwe",
    version: "1",
    chainId,
    nonce: "abcdef123456",
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expirationTime: new Date(Date.now() + 600000).toISOString(), // 10 mins future
  };

  const messageText = formatSiweMessage(fields);
  const signature = await wallet.signMessage(messageText);

  // 1. Parsing succeeds
  const parsed = parseSiweMessage(messageText);
  assert.strictEqual(parsed.domain, domain);
  assert.strictEqual(parsed.address.toLowerCase(), wallet.address.toLowerCase());
  assert.strictEqual(parsed.chainId, chainId);
  assert.strictEqual(parsed.nonce, "abcdef123456");

  // 2. Verification succeeds
  const verification = verifySiweSignature(messageText, signature, domain, chainId);
  assert.strictEqual(verification.isValid, true);
  assert.strictEqual(verification.address.toLowerCase(), wallet.address.toLowerCase());

  // 3. Fail-closed: Domain mismatch is rejected
  const domainMismatch = verifySiweSignature(messageText, signature, "phishing-site.com", chainId);
  assert.strictEqual(domainMismatch.isValid, false);
  assert.ok(domainMismatch.error?.includes("Domain mismatch"));

  // 4. Fail-closed: Chain ID mismatch is rejected
  const chainMismatch = verifySiweSignature(messageText, signature, domain, 1);
  assert.strictEqual(chainMismatch.isValid, false);
  assert.ok(chainMismatch.error?.includes("Chain ID mismatch"));

  // 5. Fail-closed: Expired session message is rejected
  const expiredFields: SiweMessageFields = {
    ...fields,
    expirationTime: new Date(Date.now() - 5000).toISOString(), // 5s past
  };
  const expiredMessageText = formatSiweMessage(expiredFields);
  const expiredSig = await wallet.signMessage(expiredMessageText);
  const expiredResult = verifySiweSignature(expiredMessageText, expiredSig, domain, chainId);
  assert.strictEqual(expiredResult.isValid, false);
  assert.ok(expiredResult.error?.includes("expired"));
});

test("SIWE Authentication: Configures HTTP-only secure cookie settings", () => {
  const prodCookie = getSecureSessionCookieOptions(true);
  assert.strictEqual(prodCookie.httpOnly, true);
  assert.strictEqual(prodCookie.secure, true);
  assert.strictEqual(prodCookie.sameSite, "lax");
  assert.strictEqual(prodCookie.path, "/");

  const devCookie = getSecureSessionCookieOptions(false);
  assert.strictEqual(devCookie.httpOnly, true);
  assert.strictEqual(devCookie.secure, false);
});
