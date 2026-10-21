/**
 * AI-Assisted / Automated Screening.
 *
 * This module performs DETERMINISTIC rule-based anomaly screening. No external
 * AI API is called, and the module is labelled as automated screening in the UI.
 * It NEVER makes the final verification decision — it only surfaces risk signals
 * for the human NCCR verifier.
 *
 * To plug in a real model later, implement the same `ScreeningResult` contract in
 * a server function that calls the model, and keep this file as the fallback.
 */
import type { EvidenceRow, ProjectRow } from "./domain";
import { haversineKm } from "./validation-engine";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ScreeningFinding {
  state: "OK" | "FLAG";
  message: string;
}

export interface ScreeningResult {
  risk_level: RiskLevel;
  risk_score: number;
  findings: ScreeningFinding[];
  summary: string;
  engine: "RULE_BASED";
}

export function runScreening(
  project: Partial<ProjectRow>,
  evidence: Pick<
    EvidenceRow,
    "file_hash" | "file_name" | "latitude" | "longitude" | "capture_date"
  >[] = [],
): ScreeningResult {
  const findings: ScreeningFinding[] = [];
  let score = 0;

  // GPS availability
  const hasGps = project.latitude != null && project.longitude != null;
  if (hasGps)
    findings.push({ state: "OK", message: "GPS information available for the project site" });
  else {
    findings.push({ state: "FLAG", message: "GPS coordinates are missing or inconsistent" });
    score += 30;
  }

  // Evidence volume
  if (evidence.length >= 3)
    findings.push({ state: "OK", message: `Evidence count sufficient (${evidence.length} items)` });
  else {
    findings.push({
      state: "FLAG",
      message: `Supporting evidence appears insufficient (${evidence.length} item(s))`,
    });
    score += evidence.length === 0 ? 30 : 15;
  }

  // Duplicate imagery
  const keys = evidence.map((e) => e.file_hash || e.file_name.toLowerCase());
  const dupCount = keys.length - new Set(keys).size;
  if (dupCount === 0)
    findings.push({ state: "OK", message: "No obvious duplicate images detected" });
  else {
    findings.push({
      state: "FLAG",
      message: `${dupCount} image(s) appear duplicated across submissions`,
    });
    score += Math.min(25, 12 * dupCount);
  }

  // Geo dispersion of evidence
  if (hasGps) {
    const tagged = evidence.filter((e) => e.latitude != null && e.longitude != null);
    const far = tagged.filter(
      (e) => haversineKm(project.latitude!, project.longitude!, e.latitude!, e.longitude!) > 25,
    ).length;
    if (tagged.length > 0 && far === 0)
      findings.push({
        state: "OK",
        message: "Evidence geo-tags cluster around the registered site",
      });
    else if (far > 0) {
      findings.push({
        state: "FLAG",
        message: `${far} evidence geo-tag(s) inconsistent with the project site`,
      });
      score += 20;
    }
  }

  // Restoration dates
  const start = project.restoration_start ? new Date(project.restoration_start) : null;
  const end = project.restoration_end ? new Date(project.restoration_end) : null;
  if (start && end && end > start)
    findings.push({ state: "OK", message: "Restoration dates are consistent" });
  else {
    findings.push({ state: "FLAG", message: "Restoration dates are missing or inconsistent" });
    score += 15;
  }

  // Plantation density plausibility
  const area = Number(project.area_hectares ?? 0);
  const density = area > 0 ? Number(project.plant_count ?? 0) / area : 0;
  if (density > 20000) {
    findings.push({
      state: "FLAG",
      message: `Reported plantation count appears unusually high (${Math.round(density)} units/ha)`,
    });
    score += 20;
  } else if (area > 0) {
    findings.push({
      state: "OK",
      message: "Reported plantation intensity is within expected bounds",
    });
  }

  // Survival rate plausibility
  const survival = project.survival_rate == null ? null : Number(project.survival_rate);
  if (survival != null && survival > 98) {
    findings.push({
      state: "FLAG",
      message: `Reported survival rate (${survival}%) is optimistically high`,
    });
    score += 10;
  }

  // Carbon plausibility
  const carbon = Number(project.estimated_carbon ?? 0);
  if (area > 0 && carbon > 0 && carbon / area > 500) {
    findings.push({
      state: "FLAG",
      message: "Estimated carbon impact per hectare exceeds the demonstration plausibility band",
    });
    score += 20;
  }

  const risk_score = Math.min(100, score);
  const risk_level: RiskLevel = risk_score >= 45 ? "HIGH" : risk_score >= 20 ? "MEDIUM" : "LOW";
  const flags = findings.filter((f) => f.state === "FLAG").length;
  const summary =
    risk_level === "LOW"
      ? "Automated screening found no significant anomalies. Manual verification by an NCCR verifier is still required."
      : `Automated screening raised ${flags} signal(s) requiring attention. The verifier must manually review this project.`;

  return { risk_level, risk_score, findings, summary, engine: "RULE_BASED" };
}
