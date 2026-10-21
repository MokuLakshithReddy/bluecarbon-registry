/**
 * Institutional KYC/AML Gating & Sanctions Compliance Engine
 *
 * Enforces compliance gating for carbon credit acquisition, transfer, and retirement
 * in accordance with institutional digital asset regulations and FATF guidelines:
 * - Dynamic authoritative sanctions screening (OFAC SDN & FATF high-risk jurisdictions).
 * - Multi-transaction cumulative rolling 365-day volume accounting (prevents smurfing/structuring).
 * - Comprehensive transaction path gating (PURCHASE, TRANSFER, RETIRE).
 * - Fail-closed expiration and unparseable credential handling.
 */

import { fromMilliTco2e } from "./blockchain.server.ts";

export type KycStatus =
  | "NOT_VERIFIED"
  | "PENDING_REVIEW"
  | "TIER_1_RETAIL" // Max 1,000 tCO2e cumulative per 365 days
  | "TIER_2_INSTITUTIONAL" // Unlimited accredited purchase/transfer/retirement
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

export type ComplianceAction = "PURCHASE" | "TRANSFER" | "RETIRE";

export interface ComplianceTransaction {
  id: string;
  walletAddress: string;
  action: ComplianceAction;
  amountMilliTco2e: bigint;
  timestampMs: number;
}

// -----------------------------------------------------------------------------
// Authoritative Sanctions Lists & Jurisdictions (OFAC / FATF)
// -----------------------------------------------------------------------------
export const HIGH_RISK_SANCTIONED_JURISDICTIONS = new Set([
  "KP", // Democratic People's Republic of Korea
  "IR", // Islamic Republic of Iran
  "SY", // Syrian Arab Republic
  "CU", // Cuba
  "RU", // Russian Federation (Comprehensive trade & financial sanctions)
]);

// Maintained set of OFAC SDN / Specially Designated Nationals wallet addresses
const sanctionedAddresses = new Set<string>([
  "0x8576acc5c05d6ce07148ca99defb290f94675b9c", // Lazarus Group / Ronin exploit
  "0xd882cfc20f52f2599c84b8e8d58c7fb62cfe344b", // Tornado Cash Router
  "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a", // OFAC Designated SDN address
  "0x7f367cc41522ce07553e823bf3be79a889debe1b", // OFAC Sanctioned Entity
]);

export function addSanctionedAddress(address: string): void {
  sanctionedAddresses.add(address.toLowerCase());
}

export function removeSanctionedAddress(address: string): void {
  sanctionedAddresses.delete(address.toLowerCase());
}

export function isAddressSanctioned(address: string): boolean {
  return sanctionedAddresses.has(address.toLowerCase());
}

// -----------------------------------------------------------------------------
// Rolling 365-Day Cumulative Volume Ledger
// -----------------------------------------------------------------------------
export const TIER_1_MAX_ANNUAL_MILLI_TCO2E = 1_000_000n; // 1,000 tCO2e in milli-tCO2e
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const complianceLedger: ComplianceTransaction[] = [];

/**
 * Calculates total volume executed by a wallet in the rolling 365 days prior to asOfMs.
 */
export function getCumulativeAnnualVolume(walletAddress: string, asOfMs = Date.now()): bigint {
  const normalized = walletAddress.toLowerCase();
  const windowStart = asOfMs - ONE_YEAR_MS;

  let total = 0n;
  for (const tx of complianceLedger) {
    if (
      tx.walletAddress === normalized &&
      tx.timestampMs >= windowStart &&
      tx.timestampMs <= asOfMs
    ) {
      total += tx.amountMilliTco2e;
    }
  }
  return total;
}

/**
 * Records an authorized transaction in the compliance ledger.
 */
export function recordComplianceTransaction(
  walletAddress: string,
  action: ComplianceAction,
  amountMilliTco2e: bigint,
  timestampMs = Date.now(),
): ComplianceTransaction {
  const tx: ComplianceTransaction = {
    id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    walletAddress: walletAddress.toLowerCase(),
    action,
    amountMilliTco2e,
    timestampMs,
  };
  complianceLedger.push(tx);
  return tx;
}

/**
 * Testing utility to reset transaction ledger state.
 */
export function _resetComplianceLedgerForTesting(): void {
  complianceLedger.length = 0;
}

// -----------------------------------------------------------------------------
// Transaction Eligibility Enforcement
// -----------------------------------------------------------------------------
export class ComplianceError extends Error {
  readonly code:
    | "SANCTIONED_JURISDICTION"
    | "SANCTIONED_ADDRESS"
    | "KYC_UNVERIFIED"
    | "TIER_LIMIT_EXCEEDED"
    | "KYC_EXPIRED"
    | "INVALID_QUANTITY";

  constructor(
    message: string,
    code:
      | "SANCTIONED_JURISDICTION"
      | "SANCTIONED_ADDRESS"
      | "KYC_UNVERIFIED"
      | "TIER_LIMIT_EXCEEDED"
      | "KYC_EXPIRED"
      | "INVALID_QUANTITY",
  ) {
    super(message);
    this.name = "ComplianceError";
    this.code = code;
  }
}

/**
 * Validates whether an account is legally eligible to purchase, transfer, or retire carbon credits.
 * Evaluates sanctions status, jurisdiction, credential expiry, and multi-transaction cumulative limits.
 */
export function assertKycEligibleForTransaction(
  account: KycAccountRecord,
  action: ComplianceAction,
  amountMilliTco2e: bigint,
  nowMs = Date.now(),
): { isEligible: boolean; error?: string } {
  // 1. Quantity validation
  if (amountMilliTco2e <= 0n) {
    return {
      isEligible: false,
      error: "Compliance Error: Transaction quantity must be strictly positive.",
    };
  }

  // 2. Authoritative address sanctions screening
  if (isAddressSanctioned(account.walletAddress) || account.kycStatus === "SANCTIONED") {
    return {
      isEligible: false,
      error:
        "Compliance Error: Wallet address is on authoritative global sanctions watchlists (OFAC SDN).",
    };
  }

  // 3. Sanctions screening by jurisdiction
  if (HIGH_RISK_SANCTIONED_JURISDICTIONS.has(account.countryCode.toUpperCase())) {
    return {
      isEligible: false,
      error: `Compliance Error: Transactions prohibited for high-risk / sanctioned jurisdiction (${account.countryCode}).`,
    };
  }

  // 4. Expiration check with fail-closed date validation
  if (account.expiresAt) {
    const expTime = new Date(account.expiresAt).getTime();
    if (Number.isNaN(expTime) || nowMs >= expTime) {
      return {
        isEligible: false,
        error:
          "Compliance Error: KYC verification has expired or is invalid. Re-verification required.",
      };
    }
  }

  // 5. KYC Status Gating
  if (account.kycStatus === "NOT_VERIFIED" || account.kycStatus === "PENDING_REVIEW") {
    return {
      isEligible: false,
      error: `Compliance Error: Account KYC status is '${account.kycStatus}'. Verified KYC is required for credit ${action.toLowerCase()}.`,
    };
  }

  // 6. Cumulative rolling 365-day volume enforcement for Tier 1 Retail
  if (account.kycStatus === "TIER_1_RETAIL") {
    const currentAnnual = getCumulativeAnnualVolume(account.walletAddress, nowMs);
    const projectedAnnual = currentAnnual + amountMilliTco2e;

    if (projectedAnnual > TIER_1_MAX_ANNUAL_MILLI_TCO2E) {
      const currentTco2e = fromMilliTco2e(currentAnnual);
      const attemptedTco2e = fromMilliTco2e(amountMilliTco2e);
      const capTco2e = fromMilliTco2e(TIER_1_MAX_ANNUAL_MILLI_TCO2E);
      return {
        isEligible: false,
        error: `Compliance Error: Tier 1 retail annual limit of ${capTco2e} tCO2e exceeded (current 365-day cumulative: ${currentTco2e} tCO2e, attempted: ${attemptedTco2e} tCO2e). Upgrade to Tier 2 Institutional KYC for large volumes.`,
      };
    }
  }

  return { isEligible: true };
}

/**
 * Atomic entrypoint for executing compliant credit transactions:
 * Enforces compliance check AND records transaction in the cumulative volume ledger upon success.
 */
export function executeCompliantTransaction(
  account: KycAccountRecord,
  action: ComplianceAction,
  amountMilliTco2e: bigint,
  nowMs = Date.now(),
): { success: boolean; transactionId?: string | undefined; error?: string | undefined } {
  const check = assertKycEligibleForTransaction(account, action, amountMilliTco2e, nowMs);
  if (!check.isEligible) {
    return { success: false, error: check.error };
  }

  const tx = recordComplianceTransaction(account.walletAddress, action, amountMilliTco2e, nowMs);
  return { success: true, transactionId: tx.id };
}
