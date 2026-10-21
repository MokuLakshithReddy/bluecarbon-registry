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
  validateEVMNetworkAndContract,
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

  const evm = readEvmConfig();

  // 1. Scan projects in VERIFIED_PENDING_ANCHOR first to avoid races with live workers
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

    if (!evm) {
      logger.info(
        "[DisasterRecovery] No EVM provider configured; skipping on-chain contract reconciliation.",
      );
    } else {
      const provider = new ethers.JsonRpcProvider(evm.rpcUrl);
      const validation = await validateEVMNetworkAndContract({
        provider,
        contractAddress: evm.contract,
        expectedChainId: evm.expectedChainId,
      });

      if (!validation.isValid) {
        report.errors.push(`Disaster recovery aborted: ${validation.error}`);
        return report;
      }

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

            // Recover the actual transaction hash from the RecordAnchored event log
            const filterFn = contract.filters["RecordAnchored"];
            if (!filterFn) {
              report.errors.push("RecordAnchored event filter not found on contract.");
              continue;
            }
            const filter = filterFn(bytes32);
            const events = await contract.queryFilter(filter);
            if (!events || events.length === 0 || !("transactionHash" in events[0])) {
              report.errors.push(
                `Record exists on-chain for ${proj.project_code} at block ${blockNumber}, but transaction hash could not be retrieved from event logs. Skipping confirmation to preserve audit integrity.`,
              );
              continue;
            }
            const eventLog = events[0] as ethers.EventLog;
            const realTxHash = eventLog.transactionHash;
            const realBlockNumber = eventLog.blockNumber;

            // Verify event project code matches
            const eventProjectCode = String(eventLog.args?.[1] ?? "");
            if (eventProjectCode && eventProjectCode !== proj.project_code) {
              report.errors.push(
                `Event project code mismatch for ${proj.project_code}: expected ${proj.project_code}, got ${eventProjectCode}`,
              );
              continue;
            }

            logger.info(
              `[DisasterRecovery] Project ${proj.project_code} has confirmed on-chain record at block ${realBlockNumber} with tx ${realTxHash}! Reconciling DB...`,
            );

            // Confirm in database with genuine transaction hash
            const supabaseWithRpc = supabase as unknown as {
              rpc: (
                fn: string,
                args: Record<string, unknown>,
              ) => Promise<{ error: { message: string } | null }>;
            };

            const { error: confirmErr } = await supabaseWithRpc.rpc("confirm_blockchain_anchor", {
              _project_id: proj.id,
              _record_hash: recordHash,
              _tx_hash: realTxHash,
              _block_number: realBlockNumber,
              _network: evm.network,
              _status: "CONFIRMED",
              _verifier_id: (job.payload as { verifier_id: string }).verifier_id,
              _verified_tco2e: proj.verified_carbon,
              _anchored_payload: {
                ...(job.payload as object),
                simulated: false,
                explorer_url: evm.explorerUrl ? `${evm.explorerUrl}/tx/${realTxHash}` : null,
              },
            });

            if (!confirmErr) {
              const { error: completeErr } = await supabaseWithRpc.rpc("complete_outbox_job", {
                _job_id: job.id,
                _tx_hash: realTxHash,
                _record_hash: recordHash,
              });

              if (completeErr) {
                report.errors.push(
                  `Failed to complete outbox job ${job.id} for ${proj.project_code}: ${completeErr.message}`,
                );
              } else {
                report.projectsReconciled++;
              }
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
    }
  } catch (err) {
    report.errors.push(`Reconciliation error: ${String(err)}`);
  }

  // 2. Reclaim expired outbox leases only AFTER checking on-chain mined state
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
