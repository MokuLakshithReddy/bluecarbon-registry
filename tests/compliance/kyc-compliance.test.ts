import test from "node:test";
import assert from "node:assert";
import {
  assertKycEligibleForTransaction,
  executeCompliantTransaction,
  getCumulativeAnnualVolume,
  addSanctionedAddress,
  removeSanctionedAddress,
  _resetComplianceLedgerForTesting,
  type KycAccountRecord,
} from "../../src/lib/kyc-compliance.ts";

test("KYC Compliance: Authorizes verified institutional accounts for unlimited purchases", () => {
  _resetComplianceLedgerForTesting();
  const institutionalAccount: KycAccountRecord = {
    walletAddress: "0x1111111111111111111111111111111111111111",
    legalEntityName: "Global Blue Carbon Fund LP",
    countryCode: "IN",
    kycStatus: "TIER_2_INSTITUTIONAL",
    verifiedAt: "2026-01-01T00:00:00Z",
    riskScore: 12,
  };

  // 50,000 tCO2e purchase
  const result = assertKycEligibleForTransaction(institutionalAccount, "PURCHASE", 50_000_000n);
  assert.strictEqual(result.isEligible, true);
  assert.strictEqual(result.error, undefined);
});

test("KYC Compliance: Multi-transaction cumulative volume blocks structuring / smurfing beyond 1,000 tCO2e", () => {
  _resetComplianceLedgerForTesting();
  const retailAccount: KycAccountRecord = {
    walletAddress: "0x2222222222222222222222222222222222222222",
    legalEntityName: "EcoRetail Individual",
    countryCode: "IN",
    kycStatus: "TIER_1_RETAIL",
    riskScore: 25,
  };

  const now = Date.now();

  // 1. First transaction: 600 tCO2e (600,000 milli) -> succeeds
  const tx1 = executeCompliantTransaction(
    retailAccount,
    "PURCHASE",
    600_000n,
    now - 30 * 24 * 3600 * 1000,
  );
  assert.strictEqual(tx1.success, true);
  assert.ok(tx1.transactionId);

  // 2. Second transaction: 300 tCO2e (300,000 milli) -> succeeds (total cumulative = 900 tCO2e)
  const tx2 = executeCompliantTransaction(
    retailAccount,
    "TRANSFER",
    300_000n,
    now - 10 * 24 * 3600 * 1000,
  );
  assert.strictEqual(tx2.success, true);

  const cumVolume = getCumulativeAnnualVolume(retailAccount.walletAddress, now);
  assert.strictEqual(cumVolume, 900_000n, "Cumulative volume must reflect both transactions");

  // 3. Third transaction: Attempting 200 tCO2e (200,000 milli) -> REJECTED (900 + 200 = 1,100 > 1,000 cap)
  const tx3 = executeCompliantTransaction(retailAccount, "RETIRE", 200_000n, now);
  assert.strictEqual(tx3.success, false);
  assert.ok(
    tx3.error?.includes("Tier 1 retail annual limit of 1000 tCO2e exceeded"),
    `Expected cumulative limit error message, got: ${tx3.error}`,
  );

  // 4. Allowed transaction under remainder: 100 tCO2e -> succeeds (reaches exact 1,000 cap)
  const tx4 = executeCompliantTransaction(retailAccount, "RETIRE", 100_000n, now);
  assert.strictEqual(tx4.success, true);

  // 5. Any further transaction within the year is now blocked
  const tx5 = executeCompliantTransaction(retailAccount, "RETIRE", 1_000n, now);
  assert.strictEqual(tx5.success, false);

  // 6. Rolling 365-day expiry: fast-forward 370 days from tx1, tx1 drops off
  const futureTime = now + 345 * 24 * 3600 * 1000; // tx1 is now >365 days old
  const txFuture = executeCompliantTransaction(retailAccount, "PURCHASE", 500_000n, futureTime);
  assert.strictEqual(txFuture.success, true, "Expired annual window restores quota");
});

test("KYC Compliance: Authoritative OFAC address sanctions screening and dynamic watchlists", () => {
  _resetComplianceLedgerForTesting();

  // Known OFAC sanctioned address (Tornado Cash router)
  const sanctionedWallet: KycAccountRecord = {
    walletAddress: "0xd882cfc20f52f2599c84b8e8d58c7fb62cfe344b",
    legalEntityName: "OFAC Designated Address",
    countryCode: "US",
    kycStatus: "TIER_2_INSTITUTIONAL",
    riskScore: 100,
  };

  const ofacRes = assertKycEligibleForTransaction(sanctionedWallet, "RETIRE", 100_000n);
  assert.strictEqual(ofacRes.isEligible, false);
  assert.ok(ofacRes.error?.includes("OFAC SDN"));

  // Dynamic addition of a new illicit wallet
  const targetWallet = "0x9999999999999999999999999999999999999999";
  const dynamicAccount: KycAccountRecord = {
    walletAddress: targetWallet,
    legalEntityName: "Target Entity",
    countryCode: "SG",
    kycStatus: "TIER_2_INSTITUTIONAL",
    riskScore: 20,
  };

  // Initially allowed
  assert.strictEqual(
    assertKycEligibleForTransaction(dynamicAccount, "PURCHASE", 100_000n).isEligible,
    true,
  );

  // Add to dynamic sanctions watchlist
  addSanctionedAddress(targetWallet);
  const blockedRes = assertKycEligibleForTransaction(dynamicAccount, "PURCHASE", 100_000n);
  assert.strictEqual(blockedRes.isEligible, false);
  assert.ok(blockedRes.error?.includes("sanctions watchlists"));

  // Remove from watchlist
  removeSanctionedAddress(targetWallet);
  assert.strictEqual(
    assertKycEligibleForTransaction(dynamicAccount, "PURCHASE", 100_000n).isEligible,
    true,
  );
});

test("KYC Compliance: Blocks unverified accounts, sanctioned jurisdictions, and expired credentials", () => {
  _resetComplianceLedgerForTesting();

  // 1. Unverified account
  const unverified: KycAccountRecord = {
    walletAddress: "0x3333333333333333333333333333333333333333",
    legalEntityName: "Unverified Inc",
    countryCode: "US",
    kycStatus: "NOT_VERIFIED",
    riskScore: 50,
  };
  const unverifiedRes = assertKycEligibleForTransaction(unverified, "PURCHASE", 100_000n);
  assert.strictEqual(unverifiedRes.isEligible, false);
  assert.ok(unverifiedRes.error?.includes("Verified KYC is required"));

  // 2. Sanctioned country (North Korea)
  const sanctionedJurisdiction: KycAccountRecord = {
    walletAddress: "0x4444444444444444444444444444444444444444",
    legalEntityName: "Sanctioned Entity",
    countryCode: "KP",
    kycStatus: "TIER_2_INSTITUTIONAL",
    riskScore: 99,
  };
  const sanctionRes = assertKycEligibleForTransaction(sanctionedJurisdiction, "PURCHASE", 100_000n);
  assert.strictEqual(sanctionRes.isEligible, false);
  assert.ok(sanctionRes.error?.includes("sanctioned jurisdiction"));

  // 3. Expired KYC
  const expired: KycAccountRecord = {
    walletAddress: "0x5555555555555555555555555555555555555555",
    legalEntityName: "Expired Cert Corp",
    countryCode: "SG",
    kycStatus: "TIER_2_INSTITUTIONAL",
    expiresAt: "2025-01-01T00:00:00Z", // Past
    riskScore: 30,
  };
  const expiredRes = assertKycEligibleForTransaction(expired, "TRANSFER", 100_000n);
  assert.strictEqual(expiredRes.isEligible, false);
  assert.ok(expiredRes.error?.includes("KYC verification has expired"));

  // 4. Malformed date fails closed
  const malformedDate: KycAccountRecord = {
    ...expired,
    expiresAt: "invalid-date-format",
  };
  const malformedRes = assertKycEligibleForTransaction(malformedDate, "TRANSFER", 100_000n);
  assert.strictEqual(malformedRes.isEligible, false);

  // 5. Zero or negative amounts fail closed
  const validAcct: KycAccountRecord = {
    walletAddress: "0x6666666666666666666666666666666666666666",
    legalEntityName: "Valid Corp",
    countryCode: "IN",
    kycStatus: "TIER_2_INSTITUTIONAL",
    riskScore: 10,
  };
  const zeroRes = assertKycEligibleForTransaction(validAcct, "PURCHASE", 0n);
  assert.strictEqual(zeroRes.isEligible, false);
  assert.ok(zeroRes.error?.includes("strictly positive"));
});
