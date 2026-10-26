import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  calculateScientificCarbon,
  createAuthoritativeVerifierDecision,
  type CarbonCalculationInput,
} from "../../src/lib/carbon-methodology.ts";

test("Reference Case: Real source files exist, hashes match disk bytes, and calculations reproduce exactly", () => {
  const baseDir = path.resolve(process.cwd(), "data/reference-case");

  // 1. Verify existence and read bytes of genuine source files
  const files = {
    soc: "lothian-sediment-cores-2024.csv",
    allom: "lothian-allometric-census-2024.csv",
    s2: "lothian-sentinel2-surface-reflectance-2024.json",
    ysi: "lothian-ysi-telemetry-2024.json",
  };

  const socBytes = fs.readFileSync(path.join(baseDir, files.soc));
  const allomBytes = fs.readFileSync(path.join(baseDir, files.allom));
  const s2Bytes = fs.readFileSync(path.join(baseDir, files.s2));
  const ysiBytes = fs.readFileSync(path.join(baseDir, files.ysi));

  // Compute exact SHA-256 hashes
  const socHash = crypto.createHash("sha256").update(socBytes).digest("hex");
  const allomHash = crypto.createHash("sha256").update(allomBytes).digest("hex");
  const s2Hash = crypto.createHash("sha256").update(s2Bytes).digest("hex");
  const ysiHash = crypto.createHash("sha256").update(ysiBytes).digest("hex");

  // Assert expected hashes match byte-calculated values
  assert.strictEqual(socHash, "fa5da4b858f22e1fef6778e63c58a293dc619dcc06ab21ecbc357bd317bf1222");
  assert.strictEqual(allomHash, "d09319bc3a757072bad3a448cd03d5382f6e7536ed5d4f7fb8fee051e2d31584");
  assert.strictEqual(s2Hash, "b3114264a88a4ac942a923d2e70f2f38382aaa0c234c8247166cc3dfdd11e44e");
  assert.strictEqual(ysiHash, "4183e1f4a49354296dba915768560558ba04daab30cf275d3c4c1ab16ef7e700");

  // 2. Validate internal empirical observations from parsed source files
  const allomLines = allomBytes.toString("utf-8").trim().split("\n").slice(1);
  const totalTrees = allomLines.length;
  const aliveTrees = allomLines.filter((l) => l.includes(",ALIVE,")).length;
  const survivalRate = (aliveTrees / totalTrees) * 100;
  assert.strictEqual(survivalRate, 85.0, "Allometric census establishes 85.0% survival rate");

  const ysiJson = JSON.parse(ysiBytes.toString("utf-8"));
  assert.strictEqual(
    ysiJson.metrics.salinity_ppt.mean,
    24.5,
    "YSI telemetry establishes 24.5 ppt salinity",
  );

  const s2Json = JSON.parse(s2Bytes.toString("utf-8"));
  assert.strictEqual(
    s2Json.vegetation_indices_summary.ndvi_mean,
    0.742,
    "Sentinel-2 surface reflectance establishes 0.742 NDVI",
  );

  // 3. Build authoritative verifier endorsements
  const verifier = {
    id: "nccr-auditor-dr-das",
    role: "VERIFIER" as const,
    reviewId: "rev-2024-loth-01",
  };

  const lothianCaseInput: CarbonCalculationInput = {
    ecosystem: "MANGROVE",
    areaHectares: 100.0,
    restorationStartDate: "2023-01-01T00:00:00Z",
    restorationEndDate: "2025-01-01T00:00:00Z",
    salinityPpt: 24.5,
    survivalRate: 85.0,
    hasLeakageDisplacement: false,
    tier: "TIER_3_SOIL_CORES",
    mode: "STRICT_VERIFICATION",
    structuredEvidence: [
      {
        evidenceId: "EVD-LOTH-2024-SOC-01",
        type: "SOIL_CORE_ORGANIC_CARBON_ASSAY",
        uri: "file://data/reference-case/lothian-sediment-cores-2024.csv",
        sha256Hash: socHash,
        issuer: "ICAR-CIFRI Estuarine Division",
        collectionDate: "2024-11-15T09:30:00Z",
        laboratoryMethod: "Loss-on-Ignition (LOI 550C) & Walkley-Black dry combustion",
        coordinateReferenceSystem: "EPSG:4326",
        verificationStatus: "VERIFIED",
        authoritativeDecision: createAuthoritativeVerifierDecision(
          { sha256Hash: socHash },
          verifier,
        ),
      },
      {
        evidenceId: "EVD-LOTH-2024-ALLOM-02",
        type: "ALLOMETRIC_GROWTH_SURVEY",
        uri: "file://data/reference-case/lothian-allometric-census-2024.csv",
        sha256Hash: allomHash,
        issuer: "Botanical Survey of India & WBFD",
        collectionDate: "2024-12-01T14:15:00Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: createAuthoritativeVerifierDecision(
          { sha256Hash: allomHash },
          verifier,
        ),
      },
      {
        evidenceId: "EVD-LOTH-2024-NDVI-03",
        type: "MULTISPECTRAL_RASTER",
        uri: "file://data/reference-case/lothian-sentinel2-surface-reflectance-2024.json",
        sha256Hash: s2Hash,
        issuer: "European Space Agency",
        collectionDate: "2024-12-10T04:47:11Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: createAuthoritativeVerifierDecision(
          { sha256Hash: s2Hash },
          verifier,
        ),
      },
      {
        evidenceId: "EVD-LOTH-2024-IOT-04",
        type: "CALIBRATED_SENSOR_TELEMETRY",
        uri: "file://data/reference-case/lothian-ysi-telemetry-2024.json",
        sha256Hash: ysiHash,
        issuer: "YSI Monitoring Network",
        collectionDate: "2024-12-20T18:00:00Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: createAuthoritativeVerifierDecision(
          { sha256Hash: ysiHash },
          verifier,
        ),
      },
    ],
  };

  const result = calculateScientificCarbon(lothianCaseInput);

  // Exact step-by-step verification matching documentation
  assert.strictEqual(result.tier, "Tier 3 (Site-Specific Soil Cores & Allometry)");
  assert.strictEqual(result.uncertaintyRate, 0.03);
  assert.strictEqual(result.grossSequestrationTco2e, 2506.0);
  assert.strictEqual(result.ghgEmissionsDeductionTco2e, 0.0);
  assert.strictEqual(result.leakageDeductionTco2e, 0.0);
  assert.strictEqual(result.riskBufferDeductionTco2e, 375.9);
  assert.strictEqual(result.uncertaintyDiscountTco2e, 63.9);
  assert.strictEqual(result.netModelEstimateTco2e, 2066.2);

  // Assert authoritative verification audit trail
  assert.strictEqual(result.evidenceAuditTrail?.authoritativeDecisionsBound, 4);
  assert.strictEqual(result.evidenceAuditTrail?.unverifiedItemsRejected, 0);
  assert.strictEqual(result.evidenceAuditTrail?.isAuthoritativelyVerified, true);
});

test("Reference Case: User-asserted VERIFIED status without verifier endorsement fails closed in strict mode", () => {
  const socHash = "fa5da4b858f22e1fef6778e63c58a293dc619dcc06ab21ecbc357bd317bf1222";
  const allomHash = "d09319bc3a757072bad3a448cd03d5382f6e7536ed5d4f7fb8fee051e2d31584";

  // Client provides verificationStatus: "VERIFIED" but NO authoritativeDecision
  const unendorsedInput: CarbonCalculationInput = {
    ecosystem: "MANGROVE",
    areaHectares: 100.0,
    restorationStartDate: "2023-01-01T00:00:00Z",
    restorationEndDate: "2025-01-01T00:00:00Z",
    salinityPpt: 24.5,
    survivalRate: 85.0,
    tier: "TIER_3_SOIL_CORES",
    mode: "STRICT_VERIFICATION",
    structuredEvidence: [
      {
        evidenceId: "EVD-LOTH-2024-SOC-01",
        type: "SOIL_CORE_ORGANIC_CARBON_ASSAY",
        uri: "file://data/reference-case/lothian-sediment-cores-2024.csv",
        sha256Hash: socHash,
        issuer: "ICAR-CIFRI",
        collectionDate: "2024-11-15T09:30:00Z",
        verificationStatus: "VERIFIED",
        // Note: authoritativeDecision is omitted!
      },
      {
        evidenceId: "EVD-LOTH-2024-ALLOM-02",
        type: "ALLOMETRIC_GROWTH_SURVEY",
        uri: "file://data/reference-case/lothian-allometric-census-2024.csv",
        sha256Hash: allomHash,
        issuer: "Botanical Survey of India",
        collectionDate: "2024-12-01T14:15:00Z",
        verificationStatus: "VERIFIED",
        // Note: authoritativeDecision is omitted!
      },
    ],
  };

  const result = calculateScientificCarbon(unendorsedInput);

  // Must downgrade to Tier 1 default factors!
  assert.strictEqual(result.tier, "Tier 1 (IPCC Default Factors)");
  assert.strictEqual(result.uncertaintyRate, 0.1);
  assert.strictEqual(result.evidenceAuditTrail?.authoritativeDecisionsBound, 0);
  assert.strictEqual(result.evidenceAuditTrail?.unverifiedItemsRejected, 2);
  assert.strictEqual(result.evidenceAuditTrail?.isAuthoritativelyVerified, false);
  assert.ok(
    result.defaultInputsApplied.some((w) =>
      w.includes("rejected_2_items_missing_authoritative_decision"),
    ),
  );
});
