import test from "node:test";
import assert from "node:assert";
import {
  assertKycEligibleForTransaction,
  type KycAccountRecord,
} from "../../src/lib/kyc-compliance.ts";

test("KYC Compliance: Authorizes verified institutional accounts for unlimited purchases", () => {
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

test("KYC Compliance: Enforces Tier 1 retail cap of 1,000 tCO2e", () => {
  const retailAccount: KycAccountRecord = {
    walletAddress: "0x2222222222222222222222222222222222222222",
    legalEntityName: "EcoRetail Individual",
    countryCode: "IN",
    kycStatus: "TIER_1_RETAIL",
    riskScore: 25,
  };

  // 500 tCO2e (allowed under 1,000 limit)
  const allowed = assertKycEligibleForTransaction(retailAccount, "RETIRE", 500_000n);
  assert.strictEqual(allowed.isEligible, true);

  // 2,000 tCO2e (exceeds 1,000 limit)
  const exceeded = assertKycEligibleForTransaction(retailAccount, "RETIRE", 2_000_000n);
  assert.strictEqual(exceeded.isEligible, false);
  assert.ok(exceeded.error?.includes("Tier 1 retail limit of 1,000 tCO2e exceeded"));
});

test("KYC Compliance: Blocks unverified accounts and sanctioned jurisdictions", () => {
  // Unverified account
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

  // Sanctioned country (North Korea)
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

  // Expired KYC
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
});
