/**
 * Automated validation engine (deterministic, rule based).
 * Produces an "Evidence Quality Score" out of 100 plus per-check results.
 */
import type { EvidenceRow, ProjectRow } from "./domain";

export type CheckState = "PASS" | "WARN" | "FAIL";

export interface ValidationCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  weight: number;
}

export interface ValidationResult {
  score: number;
  checks: ValidationCheck[];
}

type ProjectInput = Partial<ProjectRow>;

export function runValidation(
  project: ProjectInput,
  evidence: Pick<EvidenceRow, "file_hash" | "file_name" | "latitude" | "longitude" | "capture_date">[] = [],
): ValidationResult {
  const checks: ValidationCheck[] = [];
  const add = (
    key: string,
    label: string,
    state: CheckState,
    detail: string,
    weight = 10,
  ) => checks.push({ key, label, state, detail, weight });

  // 1. Required fields
  const required: [string, unknown][] = [
    ["Project name", project.name],
    ["Organization", project.organization],
    ["Ecosystem", project.ecosystem],
    ["State", project.state],
    ["District", project.district],
    ["Project area", project.area_hectares],
    ["Restoration method", project.restoration_method],
  ];
  const missing = required.filter(([, v]) => v == null || v === "").map(([k]) => k);
  add(
    "required",
    "Required Data",
    missing.length === 0 ? "PASS" : missing.length <= 2 ? "WARN" : "FAIL",
    missing.length === 0 ? "All mandatory registration fields are present." : `Missing: ${missing.join(", ")}.`,
    18,
  );

  // 2. Valid coordinates
  const lat = project.latitude;
  const lng = project.longitude;
  const coordsValid =
    lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const inIndiaBox = coordsValid && lat! >= 5 && lat! <= 25 && lng! >= 67 && lng! <= 95;
  add(
    "gps",
    "GPS Coordinates",
    !coordsValid ? "FAIL" : inIndiaBox ? "PASS" : "WARN",
    !coordsValid
      ? "Latitude/longitude missing or out of range."
      : inIndiaBox
        ? `Coordinates ${lat!.toFixed(4)}, ${lng!.toFixed(4)} fall within the Indian coastal region.`
        : "Coordinates are valid but fall outside the expected Indian coastal envelope.",
    16,
  );

  // 3. Evidence uploaded
  add(
    "evidence",
    "Evidence Uploaded",
    evidence.length === 0 ? "FAIL" : evidence.length < 3 ? "WARN" : "PASS",
    evidence.length === 0
      ? "No field evidence attached to this project."
      : `${evidence.length} evidence item(s) attached.`,
    16,
  );

  // 4. Duplicate detection (hash, then filename)
  const keys = evidence.map((e) => e.file_hash || e.file_name.toLowerCase());
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  add(
    "duplicates",
    "Duplicate Check",
    dupes.length === 0 ? "PASS" : dupes.length > 1 ? "FAIL" : "WARN",
    dupes.length === 0
      ? "No duplicated evidence files detected."
      : `${dupes.length} evidence file(s) appear to be duplicates.`,
    12,
  );

  // 5. Location consistency of evidence vs project site
  const geoTagged = evidence.filter((e) => e.latitude != null && e.longitude != null);
  let locationState: CheckState = "WARN";
  let locationDetail = "No geo-tagged evidence available for location cross-check.";
  if (coordsValid && geoTagged.length > 0) {
    const far = geoTagged.filter(
      (e) => haversineKm(lat!, lng!, e.latitude!, e.longitude!) > 25,
    ).length;
    locationState = far === 0 ? "PASS" : far === geoTagged.length ? "FAIL" : "WARN";
    locationDetail =
      far === 0
        ? `${geoTagged.length} geo-tagged item(s) are within 25 km of the registered site.`
        : `${far} of ${geoTagged.length} geo-tagged item(s) are more than 25 km from the registered site.`;
  }
  add("location", "Location Consistency", locationState, locationDetail, 12);

  // 6. Date consistency
  const start = project.restoration_start ? new Date(project.restoration_start) : null;
  const end = project.restoration_end ? new Date(project.restoration_end) : null;
  let dateState: CheckState = "PASS";
  let dateDetail = "Restoration period is internally consistent.";
  if (!start || !end) {
    dateState = "WARN";
    dateDetail = "Restoration start and/or end date is missing.";
  } else if (end <= start) {
    dateState = "FAIL";
    dateDetail = "Restoration end date is not after the start date.";
  } else if (start.getFullYear() < 1990 || start.getFullYear() > new Date().getFullYear() + 10) {
    dateState = "FAIL";
    dateDetail = "Restoration start date is outside a plausible range.";
  } else {
    const outOfWindow = evidence.filter((e) => {
      if (!e.capture_date) return false;
      const c = new Date(e.capture_date);
      return c < new Date(start.getTime() - 90 * 86400000) || c > new Date(Date.now() + 86400000);
    }).length;
    if (outOfWindow > 0) {
      dateState = "WARN";
      dateDetail = `${outOfWindow} evidence capture date(s) fall outside the restoration window.`;
    }
  }
  add("dates", "Date Consistency", dateState, dateDetail, 12);

  // 7. Carbon impact estimate present
  const carbon = Number(project.estimated_carbon ?? 0);
  add(
    "carbon",
    "Carbon Data",
    carbon > 0 ? "PASS" : "WARN",
    carbon > 0
      ? "Estimated carbon impact recorded for this project."
      : "Estimated carbon impact is missing or zero.",
    8,
  );

  // 8. Plausibility of numeric values
  const area = Number(project.area_hectares ?? 0);
  const density = area > 0 ? Number(project.plant_count ?? 0) / area : 0;
  const survival = project.survival_rate == null ? null : Number(project.survival_rate);
  const issues: string[] = [];
  if (area > 100000) issues.push("project area is implausibly large");
  if (area > 0 && area < 0.1) issues.push("project area is implausibly small");
  if (density > 20000) issues.push(`planting density (${Math.round(density)}/ha) is unusually high`);
  if (survival != null && (survival < 0 || survival > 100)) issues.push("survival rate is out of range");
  if (area > 0 && carbon > 0 && carbon / area > 500)
    issues.push("carbon impact per hectare exceeds the demonstration plausibility band");
  add(
    "plausibility",
    "Value Plausibility",
    issues.length === 0 ? "PASS" : issues.length > 1 ? "FAIL" : "WARN",
    issues.length === 0 ? "Reported numerical values are within plausible ranges." : capitalize(issues.join("; ")) + ".",
    6,
  );

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce(
    (s, c) => s + c.weight * (c.state === "PASS" ? 1 : c.state === "WARN" ? 0.55 : 0),
    0,
  );
  return { score: Math.round((earned / totalWeight) * 100), checks };
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
