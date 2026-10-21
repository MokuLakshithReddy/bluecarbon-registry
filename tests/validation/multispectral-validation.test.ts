import test from "node:test";
import assert from "node:assert";
import {
  MultispectralTelemetrySchema,
  checkSequestrationAnomaly,
} from "../../src/lib/multispectral-validation.ts";

test("Multispectral Validation: Zod schema enforces valid optical/radar indices", () => {
  const validTelemetry = {
    ndvi: 0.78,
    evi: 0.62,
    savi: 0.55,
    canopyCoverPercent: 82.5,
    cloudCoverFraction: 0.05,
    sensorBands: {
      redReflectance: 0.04,
      nirReflectance: 0.38,
      blueReflectance: 0.02,
      swirReflectance: 0.12,
    },
  };

  const parsed = MultispectralTelemetrySchema.safeParse(validTelemetry);
  assert.strictEqual(parsed.success, true);

  // Invalid: NDVI > 1.0 (out of bounds)
  const invalidNdvi = { ...validTelemetry, ndvi: 1.25 };
  const parsedBadNdvi = MultispectralTelemetrySchema.safeParse(invalidNdvi);
  assert.strictEqual(parsedBadNdvi.success, false);

  // Invalid: Canopy cover > 100%
  const invalidCanopy = { ...validTelemetry, canopyCoverPercent: 120 };
  const parsedBadCanopy = MultispectralTelemetrySchema.safeParse(invalidCanopy);
  assert.strictEqual(parsedBadCanopy.success, false);
});

test("Multispectral Validation: Anomaly detection flags unrealistic carbon sequestration spikes", () => {
  // 1. Mangrove claim of 50 tCO2e/ha/yr exceeds physiological threshold (35 tCO2e/ha/yr)
  const excessiveRate = checkSequestrationAnomaly({
    ecosystem: "MANGROVE",
    claimedAnnualTco2ePerHectare: 50.0,
    measuredNdvi: 0.85,
  });
  assert.strictEqual(excessiveRate.isAnomaly, true);
  assert.ok(excessiveRate.reason?.includes("exceeds the maximum physiological limit"));

  // 2. High sequestration claim (15 tCO2e/ha/yr) with barren mudflat / open water NDVI (0.05)
  const contradictoryClaim = checkSequestrationAnomaly({
    ecosystem: "MANGROVE",
    claimedAnnualTco2ePerHectare: 15.0,
    measuredNdvi: 0.05,
  });
  assert.strictEqual(contradictoryClaim.isAnomaly, true);
  assert.ok(contradictoryClaim.reason?.includes("Spectral contradiction"));

  // 3. Realistic mangrove rate (13.7 tCO2e/ha/yr) with healthy NDVI (0.75) passes
  const validClaim = checkSequestrationAnomaly({
    ecosystem: "MANGROVE",
    claimedAnnualTco2ePerHectare: 13.7,
    measuredNdvi: 0.75,
  });
  assert.strictEqual(validClaim.isAnomaly, false);
});
