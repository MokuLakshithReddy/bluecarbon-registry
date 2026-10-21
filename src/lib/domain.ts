/**
 * BlueCarbon MRV Registry — shared domain model.
 *
 * IMPORTANT PRODUCT PRINCIPLE
 * This system records ESTIMATED and VERIFIED CARBON IMPACT (tCO₂e).
 * It does NOT issue carbon credits. See CARBON_DISCLAIMER.
 */

export const CARBON_DISCLAIMER =
  "Carbon impact shown by this MVP is an estimated/verified project impact value for demonstration. Actual carbon-credit issuance requires an approved methodology, authorized verification and the applicable regulatory/registry process.";

export type ProjectStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CORRECTION_REQUIRED"
  | "VERIFIED_PENDING_ANCHOR"
  | "VERIFIED"
  | "REJECTED";

export type Ecosystem = "MANGROVE" | "SEAGRASS" | "SALT_MARSH" | "COASTAL_WETLAND" | "OTHER";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  CORRECTION_REQUIRED: "Correction Required",
  VERIFIED_PENDING_ANCHOR: "Pending On-Chain Anchor",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export const ECOSYSTEM_LABEL: Record<Ecosystem, string> = {
  MANGROVE: "Mangrove",
  SEAGRASS: "Seagrass",
  SALT_MARSH: "Salt Marsh",
  COASTAL_WETLAND: "Coastal Wetland",
  OTHER: "Other",
};

export const ECOSYSTEM_OPTIONS = Object.keys(ECOSYSTEM_LABEL) as Ecosystem[];

export const EVIDENCE_TYPES = [
  "FIELD_PHOTO",
  "DOCUMENT",
  "SURVEY_REPORT",
  "DRONE_IMAGERY",
  "OTHER",
] as const;

export const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  FIELD_PHOTO: "Field Photograph",
  DOCUMENT: "Document",
  SURVEY_REPORT: "Survey Report",
  DRONE_IMAGERY: "Drone Imagery",
  OTHER: "Other Evidence",
};

export const INDIAN_COASTAL_STATES = [
  "Andhra Pradesh",
  "Goa",
  "Gujarat",
  "Karnataka",
  "Kerala",
  "Maharashtra",
  "Odisha",
  "Tamil Nadu",
  "West Bengal",
  "Puducherry",
  "Daman & Diu",
  "Andaman & Nicobar Islands",
  "Lakshadweep",
];

export interface ProjectRow {
  id: string;
  project_code: string;
  owner_id: string | null;
  owner_email: string;
  name: string;
  organization: string | null;
  description: string | null;
  owner_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  ecosystem: Ecosystem;
  state: string | null;
  district: string | null;
  coastal_area: string | null;
  latitude: number | null;
  longitude: number | null;
  area_hectares: number | null;
  restoration_start: string | null;
  restoration_end: string | null;
  restoration_method: string | null;
  species: string | null;
  plant_count: number | null;
  survival_rate: number | null;
  estimated_carbon: number | null;
  verified_carbon: number | null;
  notes: string | null;
  status: ProjectStatus;
  submitted_at: string | null;
  verified_at: string | null;
  verifier_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  project_id: string;
  evidence_code: string | null;
  file_name: string;
  file_url: string | null;
  file_hash: string | null;
  file_size: number | null;
  evidence_type: string;
  latitude: number | null;
  longitude: number | null;
  capture_date: string | null;
  uploaded_by_email: string | null;
  review_status: string;
  reviewer_comment: string | null;
  is_public: boolean;
  created_at: string;
}

/* ------------------------------------------------------------------ *
 * SCIENTIFIC CARBON ACCOUNTING METHODOLOGY (IPCC 2013 & VM0033)
 * Replaces illustrative demonstration coefficients with peer-reviewed
 * IPCC Wetlands Supplement and Verra VM0033 blue carbon parameters.
 * ------------------------------------------------------------------ */
export {
  calculateScientificCarbon,
  SCIENTIFIC_CARBON_COEFFICIENTS,
  METHODOLOGY_SPEC,
  type DetailedCarbonAssessment,
  type CarbonCalculationInput,
} from "./carbon-methodology.ts";

import { calculateScientificCarbon, METHODOLOGY_SPEC } from "./carbon-methodology.ts";

export const CARBON_METHODOLOGY_ID = METHODOLOGY_SPEC.id;

/**
 * Calculates estimated net carbon impact in tCO₂e over the restoration period
 * using the IPCC 2013 Coastal Wetlands Supplement & Verra VM0033 framework.
 */
export function estimateCarbonImpact(input: {
  ecosystem: Ecosystem;
  area_hectares?: number | null;
  restoration_start?: string | null;
  restoration_end?: string | null;
  survival_rate?: number | null;
}): number {
  const result = calculateScientificCarbon({
    ecosystem: input.ecosystem,
    areaHectares: Number(input.area_hectares ?? 0),
    restorationStartDate: input.restoration_start,
    restorationEndDate: input.restoration_end,
    survivalRate: input.survival_rate,
  });
  return result.netEstimatedTco2e;
}

/**
 * Calculates conservative net verified carbon impact in tCO₂e,
 * withholding mandatory 15% non-permanence risk buffer and uncertainty discount.
 */
export function calculateVerifiedCarbonImpact(input: {
  ecosystem: Ecosystem;
  area_hectares?: number | null;
  restoration_start?: string | null;
  restoration_end?: string | null;
  survival_rate?: number | null;
}): number {
  const result = calculateScientificCarbon({
    ecosystem: input.ecosystem,
    areaHectares: Number(input.area_hectares ?? 0),
    restorationStartDate: input.restoration_start,
    restorationEndDate: input.restoration_end,
    survivalRate: input.survival_rate,
  });
  return result.netVerifiedTco2e;
}

export function formatTco2e(value?: number | null): string {
  if (value == null) return "—";
  return `${Number(value).toLocaleString("en-IN")} tCO₂e`;
}

export function formatNumber(value?: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${Number(value).toLocaleString("en-IN")}${suffix}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function shortHash(value?: string | null, head = 6, tail = 4): string {
  if (!value) return "—";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
