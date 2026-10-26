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

test("Carbon Methodology: Tier 2 site sampling reduces scientific uncertainty discount from 10% to 5%", () => {
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
    tierSupportingEvidence: ["storage://evidence/p1/biomass-sample-lab-results.pdf"],
  });

  assert.strictEqual(tier1.uncertaintyRate, 0.1);
  assert.strictEqual(tier2.uncertaintyRate, 0.05);
  assert.ok(tier2.uncertaintyDiscountTco2e < tier1.uncertaintyDiscountTco2e);
  assert.ok(tier2.netVerifiedTco2e >= tier1.netVerifiedTco2e);
});

test("Carbon Methodology: Enforces Tier 2/3 evidence requirements and downgrades to Tier 1 if missing", () => {
  // Tier 2 requested without evidence must downgrade to Tier 1
  const missingTier2 = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    tier: "TIER_2_SITE_CALIBRATED",
  });
  assert.strictEqual(missingTier2.tier, "Tier 1 (IPCC Default Factors)");
  assert.ok(
    missingTier2.defaultInputsApplied.includes(
      "tier_downgraded_to_tier_1_missing_tier_2_sampling_evidence",
    ),
  );

  // Tier 3 requested with only 1 evidence item (requires >= 2: soil cores + allometry) must downgrade to Tier 1
  const insufficientTier3 = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    tier: "TIER_3_SOIL_CORES",
    tierSupportingEvidence: ["storage://evidence/p1/only-one-file.pdf"],
  });
  assert.strictEqual(insufficientTier3.tier, "Tier 1 (IPCC Default Factors)");
  assert.ok(
    insufficientTier3.defaultInputsApplied.includes(
      "tier_downgraded_to_tier_1_missing_tier_3_soil_core_and_allometric_evidence",
    ),
  );
});

test("Carbon Methodology: Structured evidence validation verifies required evidence types for Tier 2 and Tier 3", () => {
  // Providing 2 drone rasters without soil core assay must not qualify for Tier 3
  const wrongEvidenceTypes = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 20,
    tier: "TIER_3_SOIL_CORES",
    structuredEvidence: [
      {
        evidenceId: "ev-01",
        type: "DRONE_AERIAL_SURVEY",
        uri: "storage://evidence/p1/drone-orthomosaic.tif",
        sha256Hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        issuer: "Coastal Mapping Services Ltd",
        collectionDate: "2025-06-01",
        verificationStatus: "VERIFIED",
      },
      {
        evidenceId: "ev-02",
        type: "MULTISPECTRAL_RASTER",
        uri: "storage://evidence/p1/ndvi-raster.tif",
        sha256Hash: "123456abcdef7890123456abcdef7890123456abcdef7890123456abcdef7890",
        issuer: "Satellite Earth Observation Lab",
        collectionDate: "2025-06-02",
        verificationStatus: "VERIFIED",
      },
    ],
  });

  assert.strictEqual(wrongEvidenceTypes.tier, "Tier 1 (IPCC Default Factors)");
  assert.strictEqual(wrongEvidenceTypes.evidenceAuditTrail?.requiredEvidenceMet, false);

  // Providing verified SOIL_CORE_ORGANIC_CARBON_ASSAY and ALLOMETRIC_GROWTH_SURVEY qualifies for Tier 3
  const validTier3 = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 20,
    tier: "TIER_3_SOIL_CORES",
    structuredEvidence: [
      {
        evidenceId: "ev-core",
        type: "SOIL_CORE_ORGANIC_CARBON_ASSAY",
        uri: "storage://evidence/p1/soil-core-depth-profile.pdf",
        sha256Hash: "c01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01ec01e",
        issuer: "National Marine Chemistry Laboratory",
        collectionDate: "2025-05-15",
        laboratoryMethod: "Loss-on-Ignition at 450C & Walkley-Black dry oxidation",
        coordinateReferenceSystem: "EPSG:4326",
        verificationStatus: "VERIFIED",
      },
      {
        evidenceId: "ev-allometry",
        type: "ALLOMETRIC_GROWTH_SURVEY",
        uri: "storage://evidence/p1/tree-diameter-height-census.csv",
        sha256Hash: "a110a110a110a110a110a110a110a110a110a110a110a110a110a110a110a110",
        issuer: "Forestry Research Institute",
        collectionDate: "2025-05-20",
        verificationStatus: "VERIFIED",
      },
    ],
  });

  assert.strictEqual(validTier3.tier, "Tier 3 (Site-Specific Soil Cores & Allometry)");
  assert.strictEqual(validTier3.uncertaintyRate, 0.03);
  assert.strictEqual(validTier3.evidenceAuditTrail?.requiredEvidenceMet, true);
});

test("Carbon Methodology: Strict verification mode fails closed on missing dates, missing survival, or missing salinity", () => {
  // Missing dates in strict mode
  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        survivalRate: 85,
        salinityPpt: 25,
        mode: "STRICT_VERIFICATION",
      }),
    /Strict Verification Error: Valid restorationStartDate and restorationEndDate are required/,
  );

  // Missing survival rate in strict mode
  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        restorationStartDate: "2024-01-01",
        restorationEndDate: "2026-01-01",
        salinityPpt: 25,
        mode: "STRICT_VERIFICATION",
      }),
    /Strict Verification Error: Measured seedling survival rate is required/,
  );

  // Out of bounds survival rate
  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        restorationStartDate: "2024-01-01",
        restorationEndDate: "2026-01-01",
        survivalRate: 150, // > 100%
        salinityPpt: 25,
        mode: "STRICT_VERIFICATION",
      }),
    /Invalid survival rate: 150/,
  );

  // Missing salinity in strict mode
  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        restorationStartDate: "2024-01-01",
        restorationEndDate: "2026-01-01",
        survivalRate: 85,
        mode: "STRICT_VERIFICATION",
      }),
    /Strict Verification Error: Measured salinity \(ppt\) is required/,
  );
});

test("Carbon Methodology: Calculation regression benchmarks check formula consistency against chosen test baselines", () => {
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
      `${benchmark.name} gross sequestration ${calc.grossSequestrationTco2e} within baseline regression range [${benchmark.expectedGrossRange[0]}, ${benchmark.expectedGrossRange[1]}]`,
    );

    assert.ok(
      calc.netVerifiedTco2e >= benchmark.expectedNetVerifiedRange[0] &&
        calc.netVerifiedTco2e <= benchmark.expectedNetVerifiedRange[1],
      `${benchmark.name} net verified carbon ${calc.netVerifiedTco2e} within baseline regression range [${benchmark.expectedNetVerifiedRange[0]}, ${benchmark.expectedNetVerifiedRange[1]}]`,
    );
  }
});

test("Carbon Methodology: Independent empirical validation validates model predictions against peer-reviewed field studies", async () => {
  const { validateModelAgainstEmpiricalData, EMPIRICAL_FIELD_STUDIES } =
    await import("../../src/lib/empirical-validation-data.ts");

  assert.strictEqual(EMPIRICAL_FIELD_STUDIES.length, 3);
  const report = validateModelAgainstEmpiricalData(calculateScientificCarbon);

  assert.strictEqual(report.totalStudiesEvaluated, 3);
  assert.strictEqual(report.allWithinEmpiricalConfidenceIntervals, true);
  // Mean absolute percentage error in gross accumulation rate across field studies should be under 15%
  assert.ok(
    report.meanAbsolutePercentErrorGrossRate < 15,
    `MAPE ${report.meanAbsolutePercentErrorGrossRate}% is under acceptable 15% threshold for IPCC Tier 1 models`,
  );

  for (const metric of report.metrics) {
    assert.strictEqual(
      metric.isWithin95ConfidenceInterval,
      true,
      `${metric.siteName} (${metric.studyId}) model net verified (${metric.modelNetVerified}) must fall within empirical 95% CI`,
    );
  }
});

test("Carbon Methodology: Tier 3 produces accurate human-readable label and discount", () => {
  const result = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 15,
    tier: "TIER_3_SOIL_CORES",
    tierSupportingEvidence: [
      "storage://evidence/p1/soil-cores-depth-analysis.pdf",
      "storage://evidence/p1/destructive-allometric-harvest-data.csv",
    ],
  });
  assert.strictEqual(result.tier, "Tier 3 (Site-Specific Soil Cores & Allometry)");
  assert.strictEqual(result.uncertaintyRate, 0.03);
  assert.ok(result.uncertaintyDiscountTco2e > 0);
});

test("Carbon Methodology: Reversed or invalid dates throw descriptive validation errors", () => {
  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        restorationStartDate: "2026-01-01",
        restorationEndDate: "2024-01-01", // Reversed
      }),
    /strictly after start date/,
  );

  assert.throws(
    () =>
      calculateScientificCarbon({
        ecosystem: "MANGROVE",
        areaHectares: 10,
        restorationStartDate: "invalid-date",
        restorationEndDate: "2024-01-01",
      }),
    /Invalid restoration date format/,
  );
});

test("Carbon Methodology: Tracks provenance of defaulted inputs in exploratory mode", () => {
  const result = calculateScientificCarbon({
    ecosystem: "MANGROVE",
    areaHectares: 10,
    mode: "EXPLORATORY",
  });
  assert.ok(result.defaultInputsApplied.includes("restoration_duration_default_1_year"));
  assert.ok(result.defaultInputsApplied.includes("survival_rate_conservative_default_80%"));
  assert.ok(result.defaultInputsApplied.includes("salinity_coastal_marine_default_25_ppt"));
});
