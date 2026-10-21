import test from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import {
  formatSiweMessage,
  parseSiweMessage,
  verifySiweSignature,
  issueSiweNonce,
  consumeSiweNonce,
  issueDurableSiweNonce,
  consumeDurableSiweNonce,
  _resetSiweNonceStoreForTesting,
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

test("SIWE Authentication: Server-issued nonce prevents replay attacks atomically", async () => {
  _resetSiweNonceStoreForTesting();
  const wallet = ethers.Wallet.createRandom();
  const domain = "registry.bluecarbon.gov.in";
  const chainId = 80002;

  // 1. Issue a cryptographically random server nonce bound to wallet
  const serverNonce = issueSiweNonce(wallet.address);
  assert.ok(serverNonce.length >= 16, "Nonce must be high-entropy");

  const fields: SiweMessageFields = {
    domain,
    address: wallet.address,
    statement: "Sign in with Ethereum to BlueCarbon Registry",
    uri: "https://registry.bluecarbon.gov.in/auth/siwe",
    version: "1",
    chainId,
    nonce: serverNonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 300_000).toISOString(),
  };

  const messageText = formatSiweMessage(fields);
  const signature = await wallet.signMessage(messageText);

  // 2. First verification: consumes nonce and succeeds
  const firstVerification = verifySiweSignature(messageText, signature, {
    expectedDomain: domain,
    expectedChainId: chainId,
    enforceNonceConsumption: true,
  });
  assert.strictEqual(firstVerification.isValid, true, "First login must succeed");

  // 3. Replay attack: submitting the exact same message and signature again MUST FAIL
  const replayVerification = verifySiweSignature(messageText, signature, {
    expectedDomain: domain,
    expectedChainId: chainId,
    enforceNonceConsumption: true,
  });
  assert.strictEqual(replayVerification.isValid, false, "Replayed message must be rejected");
  assert.ok(
    replayVerification.error?.includes("replay prevented"),
    "Error must cite replay prevention",
  );

  // 4. Direct consume call also returns false
  assert.strictEqual(consumeSiweNonce(serverNonce, wallet.address), false);
});

test("SIWE Authentication: Enforces Not Before (nbf) time boundaries strictly", async () => {
  const wallet = ethers.Wallet.createRandom();
  const domain = "registry.bluecarbon.gov.in";
  const chainId = 80002;

  // Message with Not Before 1 hour in the future
  const futureNotBefore = new Date(Date.now() + 3600_000).toISOString();
  const prematureFields: SiweMessageFields = {
    domain,
    address: wallet.address,
    uri: "https://registry.bluecarbon.gov.in/auth/siwe",
    version: "1",
    chainId,
    nonce: "secure_nonce_12345",
    issuedAt: new Date().toISOString(),
    notBefore: futureNotBefore,
    expirationTime: new Date(Date.now() + 7200_000).toISOString(),
  };

  const prematureMsg = formatSiweMessage(prematureFields);
  const prematureSig = await wallet.signMessage(prematureMsg);

  // Verification must fail closed because message is not yet active
  const prematureResult = verifySiweSignature(prematureMsg, prematureSig, domain, chainId);
  assert.strictEqual(prematureResult.isValid, false);
  assert.ok(prematureResult.error?.includes("not yet active"));

  // Message with Not Before 5 minutes in the past succeeds
  const validNotBeforeFields: SiweMessageFields = {
    ...prematureFields,
    notBefore: new Date(Date.now() - 300_000).toISOString(),
  };
  const validMsg = formatSiweMessage(validNotBeforeFields);
  const validSig = await wallet.signMessage(validMsg);
  const validResult = verifySiweSignature(validMsg, validSig, domain, chainId);
  assert.strictEqual(validResult.isValid, true);
});

test("SIWE Authentication: Strictly validates ISO-8601 dates and fails closed on malformed values", async () => {
  const wallet = ethers.Wallet.createRandom();

  // 1. Invalid expiration time format (e.g. non-date string)
  assert.throws(() => {
    formatSiweMessage({
      domain: "registry.bluecarbon.gov.in",
      address: wallet.address,
      uri: "https://registry.bluecarbon.gov.in/auth/siwe",
      version: "1",
      chainId: 80002,
      nonce: "abcdef123456",
      issuedAt: new Date().toISOString(),
      expirationTime: "invalid-timestamp-value",
    });
  }, /Invalid ISO-8601 format/);

  // 2. Parser rejects malformed date if injected in raw text
  const malformedRawMsg =
    `registry.bluecarbon.gov.in wants you to sign in with your Ethereum account:\n` +
    `${wallet.address}\n\n` +
    `URI: https://registry.bluecarbon.gov.in/auth/siwe\n` +
    `Version: 1\n` +
    `Chain ID: 80002\n` +
    `Nonce: abcdef123456\n` +
    `Issued At: not-a-date\n`;

  assert.throws(() => {
    parseSiweMessage(malformedRawMsg);
  }, /Invalid ISO-8601 format/);

  // 3. Parser rejects unsupported version
  const badVersionMsg =
    `registry.bluecarbon.gov.in wants you to sign in with your Ethereum account:\n` +
    `${wallet.address}\n\n` +
    `URI: https://registry.bluecarbon.gov.in/auth/siwe\n` +
    `Version: 2\n` +
    `Chain ID: 80002\n` +
    `Nonce: abcdef123456\n` +
    `Issued At: ${new Date().toISOString()}\n`;

  assert.throws(() => {
    parseSiweMessage(badVersionMsg);
  }, /Unsupported SIWE version/);
});

test("SIWE Authentication: Fail-closed on durable database errors when Supabase client is present", async () => {
  const mockDbErrorClientInsert = {
    from: (_table: string) => ({
      insert: async () => ({
        error: { code: "57P01", message: "terminating connection due to administrator command" },
      }),
    }),
  };

  await assert.rejects(async () => {
    await issueDurableSiweNonce(
      mockDbErrorClientInsert as unknown as Parameters<typeof issueDurableSiweNonce>[0],
      "0x1234567890123456789012345678901234567890",
    );
  }, /Failed to persist SIWE nonce durably/);

  const mockDbErrorClientRpc = {
    rpc: async () => ({ data: null, error: { code: "57P01", message: "db connection failed" } }),
  };

  await assert.rejects(async () => {
    await consumeDurableSiweNonce(
      mockDbErrorClientRpc as unknown as Parameters<typeof consumeDurableSiweNonce>[0],
      "nonce_test_12345",
      "0x1234567890123456789012345678901234567890",
    );
  }, /Failed to consume durable SIWE nonce/);
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
