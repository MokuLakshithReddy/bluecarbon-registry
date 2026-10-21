/**
 * Dedicated Blockchain Outbox Queue Worker Runtime
 *
 * Audit Reference: Finding P1 (Outbox as Actual Source of Truth & Safe Queue Processing)
 *
 * Continuously polls and processes blockchain_outbox jobs using:
 * - PostgreSQL `FOR UPDATE SKIP LOCKED` for concurrency safety and zero lock contention
 * - Configurable lease locks (`locked_until`, `locked_by`) to recover orphaned jobs on worker crash
 * - Exponential backoff retry scheduling (`calculate_retry_backoff`)
 * - Canonical persisted payload as authoritative source of truth
 * - Idempotent finality confirmation on genuine EVM status
 * - Graceful shutdown on SIGINT / SIGTERM
 */

import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import { processOutboxJob, type VerifierClient } from "../lib/registry.server.ts";

export interface OutboxWorkerOptions {
  workerId?: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  once?: boolean;
  maxJobs?: number;
}

export async function runOutboxWorker(options: OutboxWorkerOptions = {}) {
  const workerId =
    options.workerId ||
    `outbox-worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const runOnce = options.once ?? false;
  const maxJobs = options.maxJobs ?? Infinity;

  console.log(
    `[OutboxWorker] Starting worker "${workerId}" (lease: ${leaseSeconds}s, poll: ${pollIntervalMs}ms)...`,
  );

  const supabase = supabaseAdmin as unknown as VerifierClient;
  let running = true;
  let jobsProcessed = 0;

  const stop = () => {
    if (!running) return;
    console.log(`[OutboxWorker] Stopping worker "${workerId}" gracefully...`);
    running = false;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (running && jobsProcessed < maxJobs) {
      try {
        const result = await processOutboxJob(supabase, workerId, leaseSeconds);

        if (result.processed && "jobId" in result) {
          jobsProcessed++;
          const txInfo = "txHash" in result && result.txHash ? ` tx=${result.txHash}` : "";
          const retryInfo =
            "retryDelaySeconds" in result && result.retryDelaySeconds
              ? ` retry_in=${result.retryDelaySeconds}s`
              : "";
          console.log(
            `[OutboxWorker] Job ${result.jobId} processed successfully: status=${result.status}${txInfo}${retryInfo}`,
          );

          if (runOnce) {
            continue;
          }
        } else {
          if (runOnce) {
            console.log("[OutboxWorker] No more pending jobs. Exiting run-once mode.");
            break;
          }
          // No jobs available right now, back off and wait for poll interval
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[OutboxWorker] Error during job processing:`, message);
        if (runOnce) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log(
      `[OutboxWorker] Worker "${workerId}" stopped. Total jobs processed: ${jobsProcessed}.`,
    );
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

  runOutboxWorker({
    once,
    leaseSeconds: leaseArg ? parseInt(leaseArg, 10) : 60,
    pollIntervalMs: pollArg ? parseInt(pollArg, 10) : 3000,
  }).catch((err) => {
    console.error("[OutboxWorker] Fatal error:", err);
    process.exit(1);
  });
}
