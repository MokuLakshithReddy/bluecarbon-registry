/**
 * Dedicated Blockchain Outbox Queue Worker Runtime
 *
 * Audit Reference:
 * - Finding P0 / P1: Deploy & supervise outbox worker with health checks, graceful shutdown,
 *   structured logging, crash recovery, worker lag tracking, and dead-letter failure alerts.
 *
 * Features:
 * - PostgreSQL `FOR UPDATE SKIP LOCKED` for concurrency safety and zero lock contention
 * - Configurable lease locks (`locked_until`, `locked_by`) to recover orphaned jobs on worker crash
 * - Exponential backoff retry scheduling (`calculate_retry_backoff`)
 * - Canonical persisted payload as authoritative source of truth
 * - Idempotent finality confirmation on genuine EVM status
 * - Graceful shutdown on SIGINT / SIGTERM
 * - Embedded HTTP server for health probes: /healthz (liveness), /readyz (readiness), /metrics (JSON)
 * - Automatic alert webhook dispatch when a job fails after max attempts
 */

import http from "node:http";
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import { metrics, sendCriticalAlert, workerLogger } from "../lib/observability.ts";
import { processOutboxJob, type VerifierClient } from "../lib/registry.server.ts";

export interface OutboxWorkerOptions {
  workerId?: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  once?: boolean;
  maxJobs?: number;
  healthPort?: number;
  enableHealthServer?: boolean;
}

export function createHealthServer(
  supabase: VerifierClient,
  isWorkerRunning: () => boolean,
  port: number = 9090,
): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url?.split("?")[0];

    if (url === "/healthz") {
      // Liveness probe
      if (isWorkerRunning()) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "OK", timestamp: new Date().toISOString() }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "STOPPING", timestamp: new Date().toISOString() }));
      }
      return;
    }

    if (url === "/readyz") {
      // Readiness probe: checks database connectivity
      try {
        const { error } = await supabase.from("projects").select("id").limit(1);
        if (error) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "DATABASE_UNAVAILABLE", error: error.message }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "READY", database: "HEALTHY" }));
        }
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ERROR", error: String(err) }));
      }
      return;
    }

    if (url === "/metrics") {
      // Prometheus / JSON metrics
      const snapshot = metrics.getSnapshot();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, "0.0.0.0", () => {
    workerLogger.info(`[OutboxWorker] Health server listening on http://0.0.0.0:${port}`);
  });

  return server;
}

export async function runOutboxWorker(options: OutboxWorkerOptions = {}) {
  const workerId =
    options.workerId ||
    `outbox-worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const runOnce = options.once ?? false;
  const maxJobs = options.maxJobs ?? Infinity;
  const healthPort = options.healthPort ?? Number(process.env["WORKER_HEALTH_PORT"] ?? 9090);
  const enableHealthServer = options.enableHealthServer ?? !runOnce;

  workerLogger.info(`Starting worker "${workerId}"`, {
    workerId,
    leaseSeconds,
    pollIntervalMs,
    runOnce,
  });

  const supabase = supabaseAdmin as unknown as VerifierClient;
  let running = true;
  let jobsProcessed = 0;

  let healthServer: http.Server | null = null;
  if (enableHealthServer) {
    try {
      healthServer = createHealthServer(supabase, () => running, healthPort);
    } catch (err) {
      workerLogger.warn("Could not start health server", { healthPort }, err);
    }
  }

  const stop = () => {
    if (!running) return;
    workerLogger.info(`Stopping worker "${workerId}" gracefully...`, { workerId });
    running = false;
    if (healthServer) {
      healthServer.close();
    }
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (running && jobsProcessed < maxJobs) {
      try {
        const result = await processOutboxJob(supabase, workerId, leaseSeconds);

        if (result.processed && "jobId" in result) {
          jobsProcessed++;
          metrics.incJobsClaimed();

          if (result.status === "VERIFIED" || result.status === "DEMO_SIMULATED") {
            metrics.incJobsConfirmed();
          } else if (result.status === "PENDING_RETRY") {
            metrics.incJobsRetried();
          }

          workerLogger.info(`Job processed: ${result.jobId}`, {
            workerId,
            jobId: result.jobId,
            status: result.status,
            txHash: "txHash" in result ? result.txHash : undefined,
          });

          if (runOnce) {
            continue;
          }
        } else {
          if (runOnce) {
            workerLogger.info("No more pending jobs. Exiting run-once mode.");
            break;
          }
          // No jobs available right now, back off and wait for poll interval
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      } catch (err: unknown) {
        metrics.incJobsFailed();
        const message = err instanceof Error ? err.message : String(err);
        workerLogger.error("Error during job processing", { workerId }, err);

        // Alert on critical dead-letter failure
        if (message.includes("max attempts") || message.includes("FAILED")) {
          await sendCriticalAlert("Outbox Job Permanently Failed", {
            workerId,
            error: message,
          });
        }

        if (runOnce) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (healthServer) {
      healthServer.close();
    }
    workerLogger.info(`Worker "${workerId}" stopped. Total jobs processed: ${jobsProcessed}.`, {
      workerId,
      jobsProcessed,
    });
  }

  return { workerId, jobsProcessed };
}

// Auto-run if executed directly as entrypoint
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("outbox-worker.ts")
) {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const leaseArg = args.find((a) => a.startsWith("--lease="))?.split("=")[1];
  const pollArg = args.find((a) => a.startsWith("--poll="))?.split("=")[1];
  const portArg = args.find((a) => a.startsWith("--port="))?.split("=")[1];

  runOutboxWorker({
    once,
    leaseSeconds: leaseArg ? parseInt(leaseArg, 10) : 60,
    pollIntervalMs: pollArg ? parseInt(pollArg, 10) : 3000,
    healthPort: portArg ? parseInt(portArg, 10) : 9090,
  }).catch((err) => {
    workerLogger.error("Fatal worker error", {}, err);
    process.exit(1);
  });
}
