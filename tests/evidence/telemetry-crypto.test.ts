import test from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import {
  verifySensorSignature,
  verifyDroneSurveySignature,
  signTelemetryPayload,
  computeTelemetryDigest,
  canonicalizeTelemetry,
  type SensorReadingPayload,
  type DroneSurveyPayload,
} from "../../src/lib/telemetry-crypto.server.ts";

test("Telemetry Crypto: Verifies authentic IoT sensor readings with ECDSA signatures", async () => {
  const wallet = ethers.Wallet.createRandom();

  const payload: SensorReadingPayload = {
    sensorId: "IOT-MNG-GOA-0042",
    projectId: "00000000-0000-0000-0000-000000000001",
    timestamp: "2026-10-21T12:00:00.000Z",
    salinityPpt: 28.5,
    waterLevelMeters: 1.45,
    dissolvedOxygenMgL: 6.8,
    temperatureCelsius: 27.2,
    soilOrganicCarbonPercent: 3.4,
    latitude: 15.5123,
    longitude: 73.8456,
    nonce: "random-nonce-12345",
  };

  const { signature, signerAddress } = await signTelemetryPayload(payload, wallet.privateKey);

  // Verification succeeds with matching signer
  const verification = verifySensorSignature(payload, signature, signerAddress);
  assert.strictEqual(verification.isValid, true);
  assert.strictEqual(verification.error, undefined);

  // Tamper detection: modifying salinity by even 0.1 ppt must cause failure
  const tamperedPayload: SensorReadingPayload = { ...payload, salinityPpt: 28.6 };
  const tamperedVerification = verifySensorSignature(tamperedPayload, signature, signerAddress);
  assert.strictEqual(tamperedVerification.isValid, false);
  assert.ok(tamperedVerification.error?.includes("Signature recovered"));

  // Unauthorized signer check: verifying against a different device address fails
  const impostorAddress = "0x9999999999999999999999999999999999999999";
  const impostorVerification = verifySensorSignature(payload, signature, impostorAddress);
  assert.strictEqual(impostorVerification.isValid, false);
});

test("Telemetry Crypto: Verifies drone aerial survey telemetry and raster hashes", async () => {
  const pilotWallet = ethers.Wallet.createRandom();

  const droneSurvey: DroneSurveyPayload = {
    surveyId: "DRONE-SRV-2026-Q3-01",
    projectId: "00000000-0000-0000-0000-000000000001",
    surveyDate: "2026-10-15",
    pilotLicenseId: "DGCA-IND-DRONE-88392",
    sensorModel: "MicaSense RedEdge-P Multispectral",
    flightAltitudeMeters: 120,
    areaSurveyedHectares: 45.2,
    meanNdvi: 0.74,
    meanCanopyHeightMeters: 8.6,
    rasterHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    decentralizedStorageUri: "ipfs://bafybeic5r6x4y37q5qdf3km2e7l4f3b5x4t6m8n9p0q1r2s3t4u5v6w7x8",
    nonce: "survey-nonce-9876",
  };

  const { signature, signerAddress } = await signTelemetryPayload(
    droneSurvey,
    pilotWallet.privateKey,
  );

  const verification = verifyDroneSurveySignature(droneSurvey, signature, signerAddress);
  assert.strictEqual(verification.isValid, true);

  // Digest is deterministic
  const digest1 = await computeTelemetryDigest(droneSurvey);
  const digest2 = await computeTelemetryDigest(droneSurvey);
  assert.strictEqual(digest1, digest2);
  assert.strictEqual(digest1.length, 64);
});
