import test from "node:test";
import assert from "node:assert";
import {
  calculateScientificCarbon,
  SCIENTIFIC_CARBON_COEFFICIENTS,
  METHODOLOGY_SPEC,
  REFERENCE_BENCHMARKS,
} from "../../src/lib/carbon-methodology.ts";

test("Carbon Methodology: IPCC coefficients are scientifically defined for all ecosystems", () => {
  assert.strictEqual(SCIENTIFIC_CARBON_COEFFICIENTS.MANGROVE.grossAnnualRate, 13.7);
  assert.strictEqual(SCIENTIFIC_CARBON_COEFFICIENTS.SEAGRASS.grossAnnualRate, 5.2);
  assert.strictEqual(SCIENTIFIC_CARBON_COEFFICIENTS.SALT_MARSH.grossAnnualRate, 8.3);
  assert.strictEqual(SCIENTIFIC_CARBON_COEFFICIENTS.COASTAL_WETLAND.grossAnnualRate, 7.7);

  // Methodology standard version check
  assert.strictEqual(METHODOLOGY_SPEC.id, "IPCC-WETLANDS-2013-VM0033-V2.1");
  assert.strictEqual(METHODOLOGY_SPEC.governingYear, 2026);
  assert.ok(METHODOLOGY_SPEC.disclaimer.includes("Model Estimate Only"));

  // Verify Table citations for IPCC 2013
  assert.ok(SCIENTIFIC_CARBON_COEFFICIENTS.MANGROVE.tableReference.includes("Table 4.4"));
  assert.ok(SCIENTIFIC_CARBON_COEFFICIENTS.SEAGRASS.tableReference.includes("Table 4.11"));
  assert.ok(SCIENTIFIC_CARBON_COEFFICIENTS.SALT_MARSH.tableReference.includes("Table 4.11"));
});

test("Carbon Methodology: Mangrove calculation applies biomass survival and soil accretion", () => {
  const result = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    restorationStartDate: "2024-01-01",
    restorationEndDate: "2026-01-01", // ~2 years
    survivalRate: 90,
  });

  assert.ok(result.durationYears >= 1.99 && result.durationYears <= 2.01);
  assert.strictEqual(result.effectiveAreaHectares, 10);
  assert.strictEqual(result.survivalRatePercent, 90);

  // Biomass = 10 ha * 7.8 tCO2e/ha/yr * ~2 yr * 0.9 ≈ 140.4
  assert.ok(Math.abs(result.biomassSequestrationTco2e - 140.4) <= 0.2);
  // Soil = 10 ha * 5.9 tCO2e/ha/yr * ~2 yr ≈ 118
  assert.ok(Math.abs(result.soilCarbonAccretionTco2e - 118) <= 0.2);
  // Gross ≈ 258.4
  assert.ok(Math.abs(result.grossSequestrationTco2e - 258.4) <= 0.4);

  // Non-permanence buffer withholding (15%)
  assert.ok(result.riskBufferDeductionTco2e > 0);
  assert.ok(
    Math.abs(result.riskBufferDeductionTco2e - result.grossSequestrationTco2e * 0.15) <= 0.1,
  );

  // Net verified carbon must be strictly less than gross sequestration due to risk buffer and uncertainty
  assert.ok(result.netVerifiedTco2e < result.grossSequestrationTco2e);
  assert.ok(result.netVerifiedTco2e > 0);
});

test("Carbon Methodology: Low salinity (< 18 ppt) triggers IPCC methane GHG deduction", () => {
  const marineResult = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    restorationStartDate: "2024-01-01",
    restorationEndDate: "2025-01-01",
    salinityPpt: 30, // Marine salinity >= 18 ppt
  });

  const brackishResult = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    restorationStartDate: "2024-01-01",
    restorationEndDate: "2025-01-01",
    salinityPpt: 12, // Brackish < 18 ppt
  });

  assert.strictEqual(marineResult.ghgEmissionsDeductionTco2e, 0);
  assert.ok(brackishResult.ghgEmissionsDeductionTco2e > 0);
  assert.ok(brackishResult.netVerifiedTco2e < marineResult.netVerifiedTco2e);
});

test("Carbon Methodology: Tier 2 site sampling reduces scientific uncertainty discount from 10% to 3%", () => {
  const tier1 = calculateScientificCarbon({
    ecosystem: "SEAGRASS",
    areaHectares: 20,
    restorationStartDate: "2024-01-01",
    restorationEndDate: "2025-01-01",
    tier: "TIER_1_DEFAULTS",
  });

  const tier2 = calculateScientificCarbon({
    ecosystem: "SEAGRASS",
    areaHectares: 20,
    restorationStartDate: "2024-01-01",
    restorationEndDate: "2025-01-01",
    tier: "TIER_2_SITE_CALIBRATED",
  });

  assert.ok(tier2.uncertaintyDiscountTco2e < tier1.uncertaintyDiscountTco2e);
  assert.ok(tier2.netVerifiedTco2e >= tier1.netVerifiedTco2e);
});

test("Carbon Methodology: Reference benchmarks (Sundarbans, Pichavaram, Chilika) validate against published ranges", () => {
  assert.strictEqual(REFERENCE_BENCHMARKS.length, 3);

  for (const benchmark of REFERENCE_BENCHMARKS) {
    const calc = calculateScientificCarbon({
      ecosystem: benchmark.ecosystem,
      areaHectares: benchmark.areaHectares,
      restorationStartDate: benchmark.restorationStartDate,
      restorationEndDate: benchmark.restorationEndDate,
      survivalRate: benchmark.survivalRate,
      salinityPpt: benchmark.salinityPpt,
    });

    assert.ok(
      calc.grossSequestrationTco2e >= benchmark.expectedGrossRange[0] &&
        calc.grossSequestrationTco2e <= benchmark.expectedGrossRange[1],
      `${benchmark.name} gross sequestration ${calc.grossSequestrationTco2e} within published range [${benchmark.expectedGrossRange[0]}, ${benchmark.expectedGrossRange[1]}]`,
    );

    assert.ok(
      calc.netVerifiedTco2e >= benchmark.expectedNetVerifiedRange[0] &&
        calc.netVerifiedTco2e <= benchmark.expectedNetVerifiedRange[1],
      `${benchmark.name} net verified carbon ${calc.netVerifiedTco2e} within empirical range [${benchmark.expectedNetVerifiedRange[0]}, ${benchmark.expectedNetVerifiedRange[1]}]`,
    );
  }
});
