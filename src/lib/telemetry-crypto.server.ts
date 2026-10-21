/**
 * Telemetry Cryptography & Digital Signature Verification for MRV Pipeline
 *
 * Implements cryptographic integrity verification for field IoT sensors,
 * soil probe telemetry, and drone/satellite rasters before data ingestion.
 *
 * Prevents unverified client REST injection by requiring ECDSA / Ed25519
 * cryptographic signatures over canonical telemetry payloads.
 */

import { ethers } from "ethers";

export interface SensorReadingPayload {
  sensorId: string;
  projectId: string;
  timestamp: string;
  salinityPpt: number;
  waterLevelMeters: number;
  dissolvedOxygenMgL: number;
  temperatureCelsius: number;
  soilOrganicCarbonPercent: number;
  latitude: number;
  longitude: number;
  nonce: string;
}

export interface DroneSurveyPayload {
  surveyId: string;
  projectId: string;
  surveyDate: string;
  pilotLicenseId: string;
  sensorModel: string;
  flightAltitudeMeters: number;
  areaSurveyedHectares: number;
  meanNdvi: number;
  meanCanopyHeightMeters: number;
  rasterHashSha256: string;
  decentralizedStorageUri: string; // ipfs://... or ar://...
  nonce: string;
}

/**
 * Deterministically canonicalizes telemetry objects for reproducible signing.
 */
export function canonicalizeTelemetry(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    return JSON.stringify(payload ?? null);
  }
  if (Array.isArray(payload)) {
    return `[${payload.map(canonicalizeTelemetry).join(",")}]`;
  }
  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeTelemetry(v)}`).join(",")}}`;
}

/**
 * Computes deterministic SHA-256 digest of a telemetry payload.
 */
export async function computeTelemetryDigest(payload: unknown): Promise<string> {
  const canonical = canonicalizeTelemetry(payload);
  const bytes = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies that a field IoT sensor payload was signed by the registered device key (ECDSA).
 */
export function verifySensorSignature(
  payload: SensorReadingPayload,
  signatureHex: string,
  expectedSignerAddress: string,
): { isValid: boolean; recoveredSigner: string; error?: string | undefined } {
  try {
    const canonical = canonicalizeTelemetry(payload);
    const recovered = ethers.verifyMessage(canonical, signatureHex);
    const isValid = recovered.toLowerCase() === expectedSignerAddress.toLowerCase();
    return {
      isValid,
      recoveredSigner: recovered,
      error: isValid
        ? undefined
        : `Signature recovered ${recovered}, expected ${expectedSignerAddress}`,
    };
  } catch (err) {
    return {
      isValid: false,
      recoveredSigner: "",
      error: err instanceof Error ? err.message : "Cryptographic signature recovery failed",
    };
  }
}

/**
 * Verifies drone / aerial survey telemetry payload signature.
 */
export function verifyDroneSurveySignature(
  payload: DroneSurveyPayload,
  signatureHex: string,
  expectedSignerAddress: string,
): { isValid: boolean; recoveredSigner: string; error?: string | undefined } {
  try {
    const canonical = canonicalizeTelemetry(payload);
    const recovered = ethers.verifyMessage(canonical, signatureHex);
    const isValid = recovered.toLowerCase() === expectedSignerAddress.toLowerCase();
    return {
      isValid,
      recoveredSigner: recovered,
      error: isValid
        ? undefined
        : `Signature recovered ${recovered}, expected ${expectedSignerAddress}`,
    };
  } catch (err) {
    return {
      isValid: false,
      recoveredSigner: "",
      error: err instanceof Error ? err.message : "Drone telemetry signature recovery failed",
    };
  }
}

/**
 * Utility helper to sign a telemetry payload (used by certified field gateways or test harnesses).
 */
export async function signTelemetryPayload(
  payload: unknown,
  privateKey: string,
): Promise<{ signature: string; signerAddress: string }> {
  const wallet = new ethers.Wallet(privateKey);
  const canonical = canonicalizeTelemetry(payload);
  const signature = await wallet.signMessage(canonical);
  return { signature, signerAddress: wallet.address };
}
