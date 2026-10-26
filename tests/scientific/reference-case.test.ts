import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  calculateScientificCarbon,
  createAuthoritativeVerifierDecision,
  enrollVerifier,
  revokeVerifier,
  type CarbonCalculationInput,
} from "../../src/lib/carbon-methodology.ts";
import { calculateGeodesicPolygonAreaHectares } from "../../src/lib/geo-boundary-validator.ts";
import {
  canonicalizeTelemetry,
  verifyEnrolledSensorTelemetry,
  enrollSensorDevice,
  revokeSensorDevice,
} from "../../src/lib/telemetry-crypto.server.ts";
import { ethers } from "ethers";

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
  assert.strictEqual(socHash, "cc40a8a2a3ed6cf8c864653f426aae950f4df1da878ae62be06002540829caf2");
  assert.strictEqual(allomHash, "eb1b84bed2f2f9bb8bfb8a4818ea26ecc0e66270fe634e6bf6a8d68ffd8526aa");
  assert.strictEqual(s2Hash, "063c8ea7c501722a20fa712ff9c423c36df5d1bf9df6756797dcb27242e9e3b4");
  assert.strictEqual(ysiHash, "0bcbde14d8960e1c23ca9e8ace7c77349097fac4e98ae99b58110913ce344eea");

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
  const socHash = "cc40a8a2a3ed6cf8c864653f426aae950f4df1da878ae62be06002540829caf2";
  const allomHash = "eb1b84bed2f2f9bb8bfb8a4818ea26ecc0e66270fe634e6bf6a8d68ffd8526aa";

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

test("Reference Case: Geodesic polygon area integration strictly reconciles to 100.00 hectares", () => {
  // 1. Reference research project polygon (recalculated to reconcile geometry and stated area)
  const reconciledPolygon = [
    { latitude: 21.849704, longitude: 88.319655 },
    { latitude: 21.849704, longitude: 88.329345 },
    { latitude: 21.858696, longitude: 88.329345 },
    { latitude: 21.858696, longitude: 88.319655 },
  ];

  const calculatedAreaHa = calculateGeodesicPolygonAreaHectares(reconciledPolygon);
  assert.strictEqual(
    Math.round(calculatedAreaHa * 10) / 10,
    100.0,
    "Geodesic polygon area must round to 100.0 hectares",
  );
  assert.ok(
    Math.abs(calculatedAreaHa - 100.0) < 0.05,
    `Calculated geodesic area (${calculatedAreaHa} ha) must match 100.0 ha within 0.05 ha precision`,
  );

  // 2. Contrast with the historical unconstrained bounding box (88.318..88.332, 21.848..21.860)
  const legacyPolygon = [
    { latitude: 21.848, longitude: 88.318 },
    { latitude: 21.848, longitude: 88.332 },
    { latitude: 21.86, longitude: 88.332 },
    { latitude: 21.86, longitude: 88.318 },
  ];
  const legacyAreaHa = calculateGeodesicPolygonAreaHectares(legacyPolygon);
  assert.ok(
    legacyAreaHa > 190 && legacyAreaHa < 195,
    `Legacy bounding box was ~193 hectares (${legacyAreaHa} ha), proving need for exact geodesic boundary reconciliation`,
  );
});

test("Reference Case: YSI telemetry secp256k1 cryptographic signature mathematically verifies against payload and fails on tampering", () => {
  const ysiPath = path.resolve(
    process.cwd(),
    "data/reference-case/lothian-ysi-telemetry-2024.json",
  );
  const rawContent = fs.readFileSync(ysiPath, "utf-8");
  const ysiData = JSON.parse(rawContent);

  // Separate canonical sensor reading payload from ECDSA envelope
  const { ecdsa_signature, ...payload } = ysiData;

  assert.ok(ecdsa_signature, "Signature envelope must be present");
  assert.strictEqual(ecdsa_signature.curve, "secp256k1");
  assert.ok(ecdsa_signature.signer_address, "Signer address must be present");
  assert.ok(ecdsa_signature.signature, "Signature hex must be present");
  assert.ok(ecdsa_signature.signer_public_key, "Signer public key must be present");

  // Verify that canonical representation signs cleanly
  const canonical = canonicalizeTelemetry(payload);
  const recoveredSigner = ethers.verifyMessage(canonical, ecdsa_signature.signature);

  assert.strictEqual(
    recoveredSigner.toLowerCase(),
    ecdsa_signature.signer_address.toLowerCase(),
    "Cryptographic recovery must authenticate genuine sensor device address",
  );

  // Verify that tampering any single observation in the payload causes signature verification to fail
  const tamperedPayload = JSON.parse(JSON.stringify(payload));
  tamperedPayload.metrics.salinity_ppt.mean = 24.6; // Tamper salinity by 0.1 ppt

  const tamperedCanonical = canonicalizeTelemetry(tamperedPayload);
  const tamperedRecoveredSigner = ethers.verifyMessage(
    tamperedCanonical,
    ecdsa_signature.signature,
  );

  assert.notStrictEqual(
    tamperedRecoveredSigner.toLowerCase(),
    ecdsa_signature.signer_address.toLowerCase(),
    "Tampered telemetry payload must fail cryptographic signature verification",
  );
});

test("Trusted Sensor Identity: Enrolled sensor verifies, unauthorized key and revoked key fail closed", async () => {
  const ysiPath = path.resolve(
    process.cwd(),
    "data/reference-case/lothian-ysi-telemetry-2024.json",
  );
  const rawContent = fs.readFileSync(ysiPath, "utf-8");
  const ysiData = JSON.parse(rawContent);
  const { ecdsa_signature, ...payload } = ysiData;

  // 1. Valid enrolled sensor device passes verification and returns device metadata
  const enrolledResult = verifyEnrolledSensorTelemetry(
    payload,
    ecdsa_signature.signature,
    "PRJ-LOTH-2024",
  );
  assert.strictEqual(enrolledResult.isValid, true);
  assert.strictEqual(enrolledResult.device?.deviceId, "YSI-EXO2-LOTHIAN-JETTY-01");
  assert.strictEqual(enrolledResult.device?.status, "ACTIVE");

  // 2. Cross-project submission mismatch fails
  const projectMismatch = verifyEnrolledSensorTelemetry(
    payload,
    ecdsa_signature.signature,
    "WRONG-PROJECT-ID",
  );
  assert.strictEqual(projectMismatch.isValid, false);
  assert.strictEqual(projectMismatch.errorCode, "PROJECT_MISMATCH");

  // 3. Telemetry signed by an unauthorized / unenrolled private key fails closed
  const unauthorizedWallet = ethers.Wallet.createRandom();
  const unauthorizedSignature = await unauthorizedWallet.signMessage(
    canonicalizeTelemetry(payload),
  );
  const untrustedResult = verifyEnrolledSensorTelemetry(
    payload,
    unauthorizedSignature,
    "PRJ-LOTH-2024",
  );
  assert.strictEqual(untrustedResult.isValid, false);
  assert.strictEqual(untrustedResult.errorCode, "UNTRUSTED_KEY");

  // 4. Revoked sensor device key fails closed
  const ephemeralDeviceId = "DEV-TEST-REVOKED-001";
  const ephemeralWallet = ethers.Wallet.createRandom();
  enrollSensorDevice({
    deviceId: ephemeralDeviceId,
    deviceModel: "Test Sonde",
    manufacturer: "Test Sensor Corp",
    projectCode: "PRJ-LOTH-2024",
    signerAddress: ephemeralWallet.address,
    organization: "Test Lab",
    calibrationCertificate: "CAL-TEST-001",
  });

  const ephemeralPayload = { ...payload, device_id: ephemeralDeviceId };
  const ephemeralSig = await ephemeralWallet.signMessage(canonicalizeTelemetry(ephemeralPayload));
  const preRevoke = verifyEnrolledSensorTelemetry(ephemeralPayload, ephemeralSig, "PRJ-LOTH-2024");
  assert.strictEqual(preRevoke.isValid, true, "Active enrolled sensor succeeds");

  // Now revoke device
  revokeSensorDevice(ephemeralWallet.address, "Hardware security compromise detected");
  const postRevoke = verifyEnrolledSensorTelemetry(ephemeralPayload, ephemeralSig, "PRJ-LOTH-2024");
  assert.strictEqual(postRevoke.isValid, false);
  assert.strictEqual(postRevoke.errorCode, "DEVICE_KEY_REVOKED");
});

test("Authoritative Verifier Identity: Unenrolled or revoked verifiers are rejected in strict verification mode", () => {
  const socHash = "cc40a8a2a3ed6cf8c864653f426aae950f4df1da878ae62be06002540829caf2";

  // 1. Unenrolled verifier decision
  const unenrolledVerifier = {
    id: "unauthorized-auditor-fake",
    role: "VERIFIER" as const,
    reviewId: "rev-unauthorized-001",
  };
  const unenrolledDecision = createAuthoritativeVerifierDecision(
    { sha256Hash: socHash },
    unenrolledVerifier,
  );

  const inputWithUnenrolledVerifier: CarbonCalculationInput = {
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
        authoritativeDecision: unenrolledDecision,
      },
    ],
  };

  const unenrolledResult = calculateScientificCarbon(inputWithUnenrolledVerifier);
  // Must downgrade to Tier 1 default factors because verifier is not in trusted registry!
  assert.strictEqual(unenrolledResult.tier, "Tier 1 (IPCC Default Factors)");
  assert.strictEqual(unenrolledResult.evidenceAuditTrail?.unverifiedItemsRejected, 1);
  assert.ok(
    unenrolledResult.defaultInputsApplied.some((w) =>
      w.includes("rejected_1_items_missing_authoritative_decision"),
    ),
  );

  // 2. Revoked verifier decision
  const tempVerifierId = "temp-auditor-to-revoke";
  enrollVerifier({
    verifierId: tempVerifierId,
    organization: "Temporary Testing VVB",
    accreditationBody: "NCCR",
    accreditationId: "VVB-TEMP-999",
    status: "ACTIVE",
    enrolledAt: new Date().toISOString(),
    supportedEcosystems: ["MANGROVE"],
  });

  // Now revoke
  revokeVerifier(tempVerifierId, "Accreditation expired");

  const revokedDecision = createAuthoritativeVerifierDecision(
    { sha256Hash: socHash },
    { id: tempVerifierId, role: "VERIFIER", reviewId: "rev-temp-01" },
  );

  const inputWithRevokedVerifier: CarbonCalculationInput = {
    ...inputWithUnenrolledVerifier,
    structuredEvidence: [
      {
        ...inputWithUnenrolledVerifier.structuredEvidence![0],
        authoritativeDecision: revokedDecision,
      },
    ],
  };

  const revokedResult = calculateScientificCarbon(inputWithRevokedVerifier);
  assert.strictEqual(revokedResult.tier, "Tier 1 (IPCC Default Factors)");
  assert.strictEqual(revokedResult.evidenceAuditTrail?.unverifiedItemsRejected, 1);
});
