/**
 * Institutional KYC/AML Gating & Sanction Compliance Engine
 *
 * Enforces compliance gating for carbon credit acquisition, transfer, and retirement
 * in accordance with institutional digital asset regulations and FATF guidelines.
 */

export type KycStatus =
  | "NOT_VERIFIED"
  | "PENDING_REVIEW"
  | "TIER_1_RETAIL" // Max 1,000 tCO2e per year
  | "TIER_2_INSTITUTIONAL" // Unlimited accredited purchase/retirement
  | "EXPIRED"
  | "SANCTIONED";

export interface KycAccountRecord {
  walletAddress: string;
  legalEntityName: string;
  countryCode: string; // ISO 3166-1 alpha-2
  kycStatus: KycStatus;
  verifiedAt?: string | undefined;
  expiresAt?: string | undefined;
  riskScore: number; // 0 - 100 (higher = riskier)
}

// FATF & OFAC High-Risk / Sanctioned Jurisdiction Codes
export const HIGH_RISK_SANCTIONED_JURISDICTIONS = new Set([
  "KP", // North Korea
  "IR", // Iran
  "SY", // Syria
  "CU", // Cuba
  "RU", // Russia (Comprehensive trade sanctions)
]);

export const TIER_1_MAX_ANNUAL_MILLI_TCO2E = 1_000_000n; // 1,000 tCO2e in milli-tCO2e

export class ComplianceError extends Error {
  readonly code:
    "SANCTIONED_JURISDICTION" | "KYC_UNVERIFIED" | "TIER_LIMIT_EXCEEDED" | "KYC_EXPIRED";

  constructor(
    message: string,
    code: "SANCTIONED_JURISDICTION" | "KYC_UNVERIFIED" | "TIER_LIMIT_EXCEEDED" | "KYC_EXPIRED",
  ) {
    super(message);
    this.name = "ComplianceError";
    this.code = code;
  }
}

/**
 * Validates whether an account is legally eligible to purchase, transfer, or retire carbon credits.
 */
export function assertKycEligibleForTransaction(
  account: KycAccountRecord,
  action: "PURCHASE" | "TRANSFER" | "RETIRE",
  amountMilliTco2e: bigint,
): { isEligible: boolean; error?: string } {
  // 1. Sanction screening by jurisdiction
  if (HIGH_RISK_SANCTIONED_JURISDICTIONS.has(account.countryCode.toUpperCase())) {
    return {
      isEligible: false,
      error: `Compliance Error: Transactions prohibited for high-risk / sanctioned jurisdiction (${account.countryCode}).`,
    };
  }

  // 2. Explicitly sanctioned account
  if (account.kycStatus === "SANCTIONED") {
    return {
      isEligible: false,
      error: "Compliance Error: Wallet address is on global sanctions watchlists.",
    };
  }

  // 3. Expiration check
  if (account.expiresAt) {
    const expTime = new Date(account.expiresAt).getTime();
    if (!Number.isNaN(expTime) && Date.now() >= expTime) {
      return {
        isEligible: false,
        error: "Compliance Error: KYC verification has expired. Re-verification required.",
      };
    }
  }

  // 4. KYC Status Gating
  if (account.kycStatus === "NOT_VERIFIED" || account.kycStatus === "PENDING_REVIEW") {
    return {
      isEligible: false,
      error: `Compliance Error: Account KYC status is '${account.kycStatus}'. Verified KYC is required for credit ${action.toLowerCase()}.`,
    };
  }

  // 5. Tier limits
  if (account.kycStatus === "TIER_1_RETAIL" && amountMilliTco2e > TIER_1_MAX_ANNUAL_MILLI_TCO2E) {
    return {
      isEligible: false,
      error: `Compliance Error: Tier 1 retail limit of 1,000 tCO2e exceeded. Upgrade to Tier 2 Institutional KYC for large volumes.`,
    };
  }

  return { isEligible: true };
}
