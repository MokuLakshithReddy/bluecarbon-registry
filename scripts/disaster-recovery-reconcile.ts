/**
 * Disaster Recovery & State Reconciliation Daemon / CLI
 *
 * Audit Reference: P1 — Recovery: Test backup and disaster recovery
 *
 * Reconciles state differences between the Supabase database and the blockchain:
 * 1. Identifies projects stuck in `VERIFIED_PENDING_ANCHOR`.
 * 2. Queries on-chain contract to check if anchor was mined during an ungraceful shutdown.
 * 3. Self-heals: confirms on-chain records and marks outbox jobs complete.
 * 4. Reclaims expired worker leases for stuck outbox jobs.
 */

import { ethers } from "ethers";
import { supabaseAdmin } from "../integrations/supabase/client.server.ts";
import {
  BLUE_CARBON_REGISTRY_ABI,
  canonicalize,
  readEvmConfig,
  sha256Hex,
} from "../lib/blockchain.server.ts";
import { logger } from "../lib/observability.ts";
import type { VerifierClient } from "../lib/registry.server.ts";

export interface ReconciliationReport {
  timestamp: string;
  orphanedJobsReclaimed: number;
  projectsChecked: number;
  projectsReconciled: number;
  errors: string[];
}

export async function runDisasterRecoveryReconciliation(): Promise<ReconciliationReport> {
  const supabase = supabaseAdmin as unknown as VerifierClient;
  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    orphanedJobsReclaimed: 0,
    projectsChecked: 0,
    projectsReconciled: 0,
    errors: [],
  };

  logger.info("[DisasterRecovery] Starting database & on-chain state reconciliation...");

  // 1. Reclaim expired outbox leases
  try {
    const { data: expiredJobs, error: leaseErr } = await supabase
      .from("blockchain_outbox")
      .update({
        locked_by: null,
        locked_until: null,
        status: "PENDING",
      } as never)
      .eq("status", "PROCESSING")
      .lt("locked_until", new Date().toISOString())
      .select("id");

    if (leaseErr) {
      report.errors.push(`Failed to reclaim expired leases: ${leaseErr.message}`);
    } else {
      report.orphanedJobsReclaimed = expiredJobs?.length ?? 0;
      logger.info(
        `[DisasterRecovery] Reclaimed ${report.orphanedJobsReclaimed} orphaned worker jobs.`,
      );
    }
  } catch (err) {
    report.errors.push(`Lease recovery error: ${String(err)}`);
  }

  // 2. Scan projects in VERIFIED_PENDING_ANCHOR
  try {
    const { data: pendingProjects, error: projErr } = await supabase
      .from("projects")
      .select(
        "id, project_code, name, ecosystem, state, district, latitude, longitude, area_hectares, restoration_start, restoration_end, verified_carbon",
      )
      .eq("status", "VERIFIED_PENDING_ANCHOR");

    if (projErr) {
      report.errors.push(`Failed to fetch pending projects: ${projErr.message}`);
      return report;
    }

    report.projectsChecked = pendingProjects?.length ?? 0;
    const evm = readEvmConfig();

    if (!evm) {
      logger.info(
        "[DisasterRecovery] No EVM provider configured; skipping on-chain contract reconciliation.",
      );
      return report;
    }

    const provider = new ethers.JsonRpcProvider(evm.rpcUrl);
    const contract = new ethers.Contract(evm.contract, BLUE_CARBON_REGISTRY_ABI, provider);

    for (const proj of pendingProjects || []) {
      try {
        // Fetch outbox job payload
        const { data: job } = await supabase
          .from("blockchain_outbox")
          .select("id, payload")
          .eq("project_id", proj.id)
          .maybeSingle();

        if (!job || !job.payload) continue;

        const recordHash = await sha256Hex(canonicalize(job.payload));
        const bytes32 = `0x${recordHash}`;

        const onChain = await contract.verifyRecord(bytes32);
        if (onChain && onChain[0] === true) {
          const blockNumber = Number(onChain[3]);
          logger.info(
            `[DisasterRecovery] Project ${proj.project_code} has confirmed on-chain record at block ${blockNumber}! Reconciling DB...`,
          );

          // Confirm in database
          const supabaseWithRpc = supabase as unknown as {
            rpc: (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ error: { message: string } | null }>;
          };

          const { error: confirmErr } = await supabaseWithRpc.rpc("confirm_blockchain_anchor", {
            _project_id: proj.id,
            _record_hash: recordHash,
            _tx_hash: `reconciled-block-${blockNumber}`,
            _block_number: blockNumber,
            _network: evm.network,
            _status: "CONFIRMED",
            _verifier_id: (job.payload as { verifier_id: string }).verifier_id,
            _verified_tco2e: proj.verified_carbon,
            _anchored_payload: {
              ...(job.payload as object),
              simulated: false,
              explorer_url: evm.explorerUrl ? `${evm.explorerUrl}/address/${evm.contract}` : null,
            },
          });

          if (!confirmErr) {
            await supabaseWithRpc.rpc("complete_outbox_job", {
              _job_id: job.id,
              _tx_hash: `reconciled-block-${blockNumber}`,
              _record_hash: recordHash,
            });
            report.projectsReconciled++;
          } else {
            report.errors.push(
              `Reconcile confirm error for ${proj.project_code}: ${confirmErr.message}`,
            );
          }
        }
      } catch (innerErr) {
        report.errors.push(`Error reconciling project ${proj.project_code}: ${String(innerErr)}`);
      }
    }
  } catch (err) {
    report.errors.push(`Reconciliation error: ${String(err)}`);
  }

  logger.info("[DisasterRecovery] Reconciliation complete.", report as never);
  return report;
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("disaster-recovery-reconcile.ts")
) {
  runDisasterRecoveryReconciliation().then((report) => {
    console.log("=== Disaster Recovery Reconciliation Report ===");
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.errors.length > 0 ? 1 : 0);
  });
}
