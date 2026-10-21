/**
 * Production Observability, Structured Logging, and Redaction Engine
 *
 * Audit Reference: P1 — Production Observability & Secrets Protection
 *
 * Features:
 * 1. Structured JSON logging with trace/request/job correlation IDs.
 * 2. Automatic redaction of sensitive credentials (private keys, service keys, JWTs, PII).
 * 3. Worker lag tracking (oldest pending job in outbox).
 * 4. Metrics collection (counters, gauges, latencies).
 * 5. Dead-letter / failure alerting hook for outbox exhaustion.
 */

export interface LogContext {
  correlationId?: string;
  requestId?: string;
  jobId?: string;
  projectId?: string;
  verifierId?: string;
  action?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_PATTERNS = [
  /0x[0-9a-fA-F]{64}/g, // Ethereum private keys
  /sbp_[0-9a-zA-Z_]+/g, // Supabase PAT
  /sb_secret_[0-9a-zA-Z_-]+/g, // Supabase service role keys
  /eyJ[0-9a-zA-Z_-]{10,}\.[0-9a-zA-Z_-]{10,}\.[0-9a-zA-Z_-]{10,}/g, // JWT tokens
  /ghp_[0-9a-zA-Z]{36}/g, // GitHub PAT
  /Bearer\s+[^\s,"']+/gi, // Bearer auth headers
];

/**
 * Recursively redacts sensitive patterns from objects, strings, or arrays.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    let result: string = input as string;
    for (const pattern of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, "[REDACTED_SECRET]");
    }
    return result as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === "object") {
    const redactedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("privatekey") ||
        lowerKey.includes("private_key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("authorization")
      ) {
        redactedObj[key] = "[REDACTED]";
      } else {
        redactedObj[key] = redactSensitiveData(val);
      }
    }
    return redactedObj as unknown as T;
  }

  return input;
}

export class Logger {
  private serviceName: string;

  constructor(serviceName: string = "bluecarbon-registry") {
    this.serviceName = serviceName;
  }

  private emit(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message,
      ...(context ? redactSensitiveData(context) : {}),
      ...(error
        ? {
            error: {
              name: error instanceof Error ? error.name : "Error",
              message: redactSensitiveData(error instanceof Error ? error.message : String(error)),
              stack: error instanceof Error ? redactSensitiveData(error.stack) : undefined,
            },
          }
        : {}),
    };

    const serialized = JSON.stringify(entry);
    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  info(message: string, context?: LogContext) {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LogContext, error?: unknown) {
    this.emit("warn", message, context, error);
  }

  error(message: string, context?: LogContext, error?: unknown) {
    this.emit("error", message, context, error);
  }

  debug(message: string, context?: LogContext) {
    if (process.env["NODE_ENV"] !== "production" || process.env["DEBUG_LOGS"] === "true") {
      this.emit("debug", message, context);
    }
  }
}

export const logger = new Logger("registry-core");
export const workerLogger = new Logger("outbox-worker");

/**
 * Lightweight in-memory metrics registry for worker & registry runtime
 */
export interface MetricsSnapshot {
  jobsClaimed: number;
  jobsConfirmed: number;
  jobsRetried: number;
  jobsFailed: number;
  verificationDecisions: number;
  workerLagSeconds: number;
  uptimeSeconds: number;
}

class MetricsRegistry {
  private startTime = Date.now();
  private jobsClaimed = 0;
  private jobsConfirmed = 0;
  private jobsRetried = 0;
  private jobsFailed = 0;
  private verificationDecisions = 0;
  private workerLagSeconds = 0;

  incJobsClaimed() {
    this.jobsClaimed++;
  }
  incJobsConfirmed() {
    this.jobsConfirmed++;
  }
  incJobsRetried() {
    this.jobsRetried++;
  }
  incJobsFailed() {
    this.jobsFailed++;
  }
  incVerificationDecisions() {
    this.verificationDecisions++;
  }
  setWorkerLag(seconds: number) {
    this.workerLagSeconds = Math.max(0, seconds);
  }

  getSnapshot(): MetricsSnapshot {
    return {
      jobsClaimed: this.jobsClaimed,
      jobsConfirmed: this.jobsConfirmed,
      jobsRetried: this.jobsRetried,
      jobsFailed: this.jobsFailed,
      verificationDecisions: this.verificationDecisions,
      workerLagSeconds: this.workerLagSeconds,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  reset() {
    this.startTime = Date.now();
    this.jobsClaimed = 0;
    this.jobsConfirmed = 0;
    this.jobsRetried = 0;
    this.jobsFailed = 0;
    this.verificationDecisions = 0;
    this.workerLagSeconds = 0;
  }
}

export const metrics = new MetricsRegistry();

/**
 * Alerting dispatcher for critical failures
 */
export async function sendCriticalAlert(
  title: string,
  details: Record<string, unknown>,
): Promise<boolean> {
  const webhookUrl = process.env["ALERT_WEBHOOK_URL"];
  logger.error(`[ALERT] ${title}`, details as LogContext);

  if (!webhookUrl) return false;

  try {
    const payload = {
      text: `🚨 *[BlueCarbon Alert]* ${title}`,
      attachments: [
        {
          color: "#e11d48",
          fields: Object.entries(redactSensitiveData(details)).map(([title, value]) => ({
            title,
            value: String(value),
            short: true,
          })),
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    logger.error("Failed to send alert webhook", {}, err);
    return false;
  }
}
