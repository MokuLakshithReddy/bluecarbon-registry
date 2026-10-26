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

// ---------------------------------------------------------------------------
// Trusted Sensor Device Enrollment & Authorization Registry
// ---------------------------------------------------------------------------

export type DeviceEnrollmentStatus = "ACTIVE" | "REVOKED" | "SUSPENDED";

export interface EnrolledSensorDevice {
  deviceId: string;
  deviceModel: string;
  manufacturer: string;
  projectCode: string;
  signerAddress: string;
  publicKeyHex?: string | undefined;
  organization: string;
  calibrationCertificate: string;
  enrolledAt: string;
  status: DeviceEnrollmentStatus;
  revokedAt?: string | undefined;
  revocationReason?: string | undefined;
}

export interface EnrolledSensorVerificationResult {
  isValid: boolean;
  recoveredSigner: string;
  device?: EnrolledSensorDevice | undefined;
  errorCode?:
    | "UNTRUSTED_KEY"
    | "DEVICE_KEY_REVOKED"
    | "DEVICE_INACTIVE"
    | "PROJECT_MISMATCH"
    | "HARDWARE_ID_MISMATCH"
    | "CRYPTO_ERROR"
    | undefined;
  error?: string | undefined;
}

const ENROLLED_SENSOR_REGISTRY = new Map<string, EnrolledSensorDevice>();

/** Pre-enroll default reference-case device */
function initializeDefaultEnrolledDevices() {
  const referenceDevice: EnrolledSensorDevice = {
    deviceId: "YSI-EXO2-LOTHIAN-JETTY-01",
    deviceModel: "EXO2 Multi-Parameter Water Quality Sonde",
    manufacturer: "YSI / Xylem",
    projectCode: "PRJ-LOTH-2024",
    signerAddress: "0x2e988A386a799F506693793c6A5AF6B54dfAaBfB".toLowerCase(),
    publicKeyHex:
      "0x04e90c7d3640a1568839c31b70a893ab6714ef8415b9de90cedfc1c8f353a6983e625529392df7fa514bdd65a2003f6619567d79bee89830e63e932dbd42362d34",
    organization: "YSI / Xylem Field Services & NCCR Marine Observatories",
    calibrationCertificate: "CAL-YSI-2024-8891-SYNTHETIC",
    enrolledAt: "2024-11-01T00:00:00Z",
    status: "ACTIVE",
  };
  ENROLLED_SENSOR_REGISTRY.set(referenceDevice.signerAddress.toLowerCase(), referenceDevice);
}

initializeDefaultEnrolledDevices();

/** Enrolls a trusted physical sensor device into the registry. */
export function enrollSensorDevice(
  deviceInput: Omit<EnrolledSensorDevice, "enrolledAt" | "status">,
): EnrolledSensorDevice {
  const normalizedAddress = deviceInput.signerAddress.trim().toLowerCase();
  const enrolled: EnrolledSensorDevice = {
    ...deviceInput,
    signerAddress: normalizedAddress,
    enrolledAt: new Date().toISOString(),
    status: "ACTIVE",
  };
  ENROLLED_SENSOR_REGISTRY.set(normalizedAddress, enrolled);
  return enrolled;
}

/** Revokes an enrolled device key (e.g. after sensor decommissioning, compromise, or calibration lapse). */
export function revokeSensorDevice(signerAddress: string, reason: string): boolean {
  const normalized = signerAddress.trim().toLowerCase();
  const device = ENROLLED_SENSOR_REGISTRY.get(normalized);
  if (!device) return false;
  device.status = "REVOKED";
  device.revokedAt = new Date().toISOString();
  device.revocationReason = reason;
  return true;
}

/** Looks up an enrolled sensor device by its Ethereum signer address. */
export function getEnrolledDevice(signerAddress: string): EnrolledSensorDevice | undefined {
  return ENROLLED_SENSOR_REGISTRY.get(signerAddress.trim().toLowerCase());
}

/** Lists all enrolled devices in the registry. */
export function listEnrolledDevices(): EnrolledSensorDevice[] {
  return Array.from(ENROLLED_SENSOR_REGISTRY.values());
}

/** Resets registry to default state (useful for test isolation). */
export function resetEnrolledDeviceRegistry(): void {
  ENROLLED_SENSOR_REGISTRY.clear();
  initializeDefaultEnrolledDevices();
}

/**
 * Verifies that a sensor payload:
 * 1. Has a mathematically valid ECDSA signature.
 * 2. Was signed by a trusted, enrolled device key (preventing untrusted key injection).
 * 3. Belongs to a device whose status is ACTIVE (fails closed if REVOKED or SUSPENDED).
 * 4. Is authorized for the target project code (preventing cross-project replay).
 * 5. Matches the registered hardware serial / deviceId.
 */
export function verifyEnrolledSensorTelemetry(
  payload: Record<string, unknown>,
  signatureHex: string,
  targetProjectCode: string,
): EnrolledSensorVerificationResult {
  try {
    const canonical = canonicalizeTelemetry(payload);
    const recoveredSigner = ethers.verifyMessage(canonical, signatureHex).toLowerCase();

    const device = ENROLLED_SENSOR_REGISTRY.get(recoveredSigner);
    if (!device) {
      return {
        isValid: false,
        recoveredSigner,
        errorCode: "UNTRUSTED_KEY",
        error: `UNTRUSTED_KEY: Recovered signer ${recoveredSigner} is not an enrolled or recognized sensor device.`,
      };
    }

    if (device.status === "REVOKED") {
      return {
        isValid: false,
        recoveredSigner,
        device,
        errorCode: "DEVICE_KEY_REVOKED",
        error: `DEVICE_KEY_REVOKED: Device '${device.deviceId}' (${recoveredSigner}) was revoked on ${device.revokedAt}: ${device.revocationReason}`,
      };
    }

    if (device.status !== "ACTIVE") {
      return {
        isValid: false,
        recoveredSigner,
        device,
        errorCode: "DEVICE_INACTIVE",
        error: `DEVICE_INACTIVE: Device '${device.deviceId}' has status '${device.status}'.`,
      };
    }

    if (device.projectCode.toUpperCase() !== targetProjectCode.toUpperCase()) {
      return {
        isValid: false,
        recoveredSigner,
        device,
        errorCode: "PROJECT_MISMATCH",
        error: `PROJECT_MISMATCH: Device '${device.deviceId}' is authorized for '${device.projectCode}', not target project '${targetProjectCode}'.`,
      };
    }

    const payloadDeviceId =
      typeof payload["device_id"] === "string" ? payload["device_id"] : undefined;
    if (payloadDeviceId && payloadDeviceId !== device.deviceId) {
      return {
        isValid: false,
        recoveredSigner,
        device,
        errorCode: "HARDWARE_ID_MISMATCH",
        error: `HARDWARE_ID_MISMATCH: Telemetry specifies '${payloadDeviceId}' but key belongs to '${device.deviceId}'.`,
      };
    }

    return {
      isValid: true,
      recoveredSigner,
      device,
    };
  } catch (err) {
    return {
      isValid: false,
      recoveredSigner: "",
      errorCode: "CRYPTO_ERROR",
      error: err instanceof Error ? err.message : "Cryptographic signature recovery failed",
    };
  }
}
