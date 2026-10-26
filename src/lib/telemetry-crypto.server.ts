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

export type DeviceEnrollmentStatus = "ACTIVE" | "REVOKED" | "SUSPENDED" | "EXPIRED";

export interface EnrolledSensorDevice {
  deviceId: string;
  deviceModel: string;
  manufacturer: string;
  projectCode: string;
  signerAddress: string;
  publicKeyHex?: string | undefined;
  organization: string;
  calibrationCertificate: string;
  calibrationExpiresAt: string;
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
    | "CALIBRATION_EXPIRED"
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
    calibrationExpiresAt: "2028-12-31T23:59:59Z",
    enrolledAt: "2024-11-01T00:00:00Z",
    status: "ACTIVE",
  };
  ENROLLED_SENSOR_REGISTRY.set(referenceDevice.signerAddress.toLowerCase(), referenceDevice);
}

initializeDefaultEnrolledDevices();

/** Enrolls a trusted physical sensor device into the in-memory cache. */
export function enrollSensorDevice(
  deviceInput: Omit<EnrolledSensorDevice, "enrolledAt" | "status"> & {
    status?: DeviceEnrollmentStatus | undefined;
    enrolledAt?: string | undefined;
  },
): EnrolledSensorDevice {
  const normalizedAddress = deviceInput.signerAddress.trim().toLowerCase();
  const enrolled: EnrolledSensorDevice = {
    ...deviceInput,
    calibrationExpiresAt: deviceInput.calibrationExpiresAt || "2028-12-31T23:59:59Z",
    signerAddress: normalizedAddress,
    enrolledAt: deviceInput.enrolledAt || new Date().toISOString(),
    status: deviceInput.status || "ACTIVE",
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

export interface DurableDatabaseClient {
  from: (table: string) => {
    select: (cols?: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => {
        maybeSingle: () => Promise<{
          data?: Record<string, unknown> | null;
          error?: { message?: string } | null;
        }>;
      };
    };
    upsert: (
      data: unknown,
      opts?: { onConflict?: string },
    ) => {
      select: () => {
        single: () => Promise<{
          data?: Record<string, unknown> | null;
          error?: { message?: string };
        }>;
      };
    };
    update: (data: unknown) => {
      eq: (
        col: string,
        val: unknown,
      ) => { select: () => Promise<{ data?: Record<string, unknown>[] | null; error?: unknown }> };
    };
  };
}

/**
 * Maps database row to EnrolledSensorDevice domain model.
 */
export function mapDbRowToEnrolledDevice(row: Record<string, unknown>): EnrolledSensorDevice {
  return {
    deviceId: String(row["device_id"]),
    deviceModel: String(row["device_model"]),
    manufacturer: String(row["manufacturer"]),
    projectCode: String(row["project_code"]),
    signerAddress: String(row["signer_address"]).toLowerCase(),
    publicKeyHex: row["public_key_hex"] ? String(row["public_key_hex"]) : undefined,
    organization: String(row["organization"]),
    calibrationCertificate: String(row["calibration_certificate"]),
    calibrationExpiresAt: String(row["calibration_expires_at"]),
    enrolledAt: String(row["enrolled_at"]),
    status: row["status"] as DeviceEnrollmentStatus,
    revokedAt: row["revoked_at"] ? String(row["revoked_at"]) : undefined,
    revocationReason: row["revocation_reason"] ? String(row["revocation_reason"]) : undefined,
  };
}

/**
 * Persists an enrolled sensor device durably into the PostgreSQL / Supabase trust registry.
 */
export async function enrollSensorDeviceDurable(
  supabase: DurableDatabaseClient,
  deviceInput: Omit<EnrolledSensorDevice, "enrolledAt" | "status"> & {
    calibrationExpiresAt: string;
    enrolledBy?: string | undefined;
  },
): Promise<EnrolledSensorDevice> {
  const normalizedAddress = deviceInput.signerAddress.trim().toLowerCase();
  const { data, error } = await supabase
    .from("enrolled_sensor_devices")
    .upsert(
      {
        device_id: deviceInput.deviceId,
        signer_address: normalizedAddress,
        device_model: deviceInput.deviceModel,
        manufacturer: deviceInput.manufacturer,
        project_code: deviceInput.projectCode,
        organization: deviceInput.organization,
        calibration_certificate: deviceInput.calibrationCertificate,
        calibration_expires_at: deviceInput.calibrationExpiresAt,
        public_key_hex: deviceInput.publicKeyHex ?? null,
        status: "ACTIVE",
        enrolled_by: deviceInput.enrolledBy ?? null,
      },
      { onConflict: "device_id" },
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to enroll sensor device durably: ${error?.message || "Unknown database error"}`,
    );
  }

  const device = mapDbRowToEnrolledDevice(data);
  // Synchronize local cache
  ENROLLED_SENSOR_REGISTRY.set(normalizedAddress, device);
  return device;
}

/**
 * Revokes a sensor device durably in the database with audit provenance.
 */
export async function revokeSensorDeviceDurable(
  supabase: DurableDatabaseClient,
  signerAddress: string,
  reason: string,
  revokedBy?: string,
): Promise<boolean> {
  const normalized = signerAddress.trim().toLowerCase();
  const { data, error } = await supabase
    .from("enrolled_sensor_devices")
    .update({
      status: "REVOKED",
      revocation_reason: reason,
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy ?? null,
    })
    .eq("signer_address", normalized)
    .select();

  if (error || !data || data.length === 0) {
    return false;
  }

  // Synchronize cache
  revokeSensorDevice(normalized, reason);
  return true;
}

/**
 * Looks up an enrolled sensor device durably from PostgreSQL / Supabase, falling back to cache.
 */
export async function getEnrolledDeviceDurable(
  supabase: DurableDatabaseClient | null | undefined,
  signerAddress: string,
): Promise<EnrolledSensorDevice | undefined> {
  const normalized = signerAddress.trim().toLowerCase();
  if (supabase) {
    const { data, error } = await supabase
      .from("enrolled_sensor_devices")
      .select("*")
      .eq("signer_address", normalized)
      .maybeSingle();

    if (error) {
      throw new Error(`Durable sensor registry query failed: ${error.message}`);
    }

    if (data) {
      const device = mapDbRowToEnrolledDevice(data);
      ENROLLED_SENSOR_REGISTRY.set(normalized, device);
      return device;
    }
    return undefined;
  }
  return getEnrolledDevice(normalized);
}

/**
 * Verifies that a sensor payload:
 * 1. Has a mathematically valid ECDSA signature.
 * 2. Was signed by a trusted, enrolled device key (preventing untrusted key injection).
 * 3. Belongs to a device whose status is ACTIVE (fails closed if REVOKED or SUSPENDED).
 * 4. Calibration certificate has not expired.
 * 5. Is authorized for the target project code (preventing cross-project replay).
 * 6. Matches the registered hardware serial / deviceId.
 */
export function verifyEnrolledSensorTelemetry(
  payload: Record<string, unknown>,
  signatureHex: string,
  targetProjectCode: string,
  options?: { asOfDate?: Date | undefined; resolvedDevice?: EnrolledSensorDevice | undefined },
): EnrolledSensorVerificationResult {
  try {
    const canonical = canonicalizeTelemetry(payload);
    const recoveredSigner = ethers.verifyMessage(canonical, signatureHex).toLowerCase();

    const device = options?.resolvedDevice ?? ENROLLED_SENSOR_REGISTRY.get(recoveredSigner);
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

    // Calibration certificate expiration enforcement
    const nowTime = options?.asOfDate ? options.asOfDate.getTime() : Date.now();
    if (device.calibrationExpiresAt && new Date(device.calibrationExpiresAt).getTime() <= nowTime) {
      return {
        isValid: false,
        recoveredSigner,
        device,
        errorCode: "CALIBRATION_EXPIRED",
        error: `CALIBRATION_EXPIRED: Device '${device.deviceId}' calibration expired on ${device.calibrationExpiresAt}.`,
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

/**
 * Durable version of verifyEnrolledSensorTelemetry querying the persistent database trust registry.
 */
export async function verifyEnrolledSensorTelemetryDurable(
  supabase: DurableDatabaseClient | null | undefined,
  payload: Record<string, unknown>,
  signatureHex: string,
  targetProjectCode: string,
  options?: { asOfDate?: Date | undefined },
): Promise<EnrolledSensorVerificationResult> {
  try {
    const canonical = canonicalizeTelemetry(payload);
    const recoveredSigner = ethers.verifyMessage(canonical, signatureHex).toLowerCase();
    const durableDevice = await getEnrolledDeviceDurable(supabase, recoveredSigner);

    return verifyEnrolledSensorTelemetry(payload, signatureHex, targetProjectCode, {
      ...options,
      resolvedDevice: durableDevice,
    });
  } catch (err) {
    return {
      isValid: false,
      recoveredSigner: "",
      errorCode: "CRYPTO_ERROR",
      error: err instanceof Error ? err.message : "Cryptographic signature recovery failed",
    };
  }
}
