/**
 * Server-only registry operations: verification decisions, blockchain anchoring,
 * secure evidence URL signing, and public verification lookup.
 *
 * Audit Reference: Findings 1, 2, 3, 4, 5 (Security, Integrity, Blockchain, Methodology)
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { anchorVerifiedRecord, type AnchorPayload } from "./blockchain.server.ts";
import { CARBON_METHODOLOGY_ID } from "./domain.ts";
import type { PublicProjectPayload, PublicProjectSummary } from "./public-types.ts";

export function publicServerClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase configuration in environment (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).",
    );
  }

  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const STORAGE_PREFIX = "storage://";
const EVIDENCE_STORAGE_REGEX = /^storage:\/\/evidence\/([0-9a-fA-F-]{36})\/(.+)$/;

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Public (no auth) verification lookup — PII is stripped and non-public evidence omitted. */
export async function fetchPublicProject(code: string): Promise<PublicProjectPayload | null> {
  const client = publicServerClient();
  const { data, error } = await client.rpc("get_public_project", { _code: code });
  if (error) throw new Error(`Failed to fetch public project: ${error.message}`);
  if (!data) return null;

  const payload = data as unknown as PublicProjectPayload;

  // Filter out any evidence items not marked as public
  if (payload.evidence && Array.isArray(payload.evidence)) {
    payload.evidence = payload.evidence.filter(
      (e) => (e as { is_public?: boolean }).is_public !== false,
    );
  }

  // Sign URLs only for approved public evidence
  const admin = await getAdmin();
  for (const item of payload.evidence ?? []) {
    if (item.file_url?.startsWith(STORAGE_PREFIX)) {
      const match = item.file_url.match(EVIDENCE_STORAGE_REGEX);
      if (match) {
        const storagePath = `${match[1]}/${match[2]}`;
        const { data: signed } = await admin.storage
          .from("evidence")
          .createSignedUrl(storagePath, 3600);
        item.file_url = signed?.signedUrl ?? null;
      } else {
        item.file_url = null;
      }
    }
  }

  return payload;
}

export async function fetchPublicProjects(): Promise<PublicProjectSummary[]> {
  const client = publicServerClient();
  const { data, error } = await client.rpc("list_public_projects");
  if (error) throw new Error(`Failed to fetch public projects: ${error.message}`);
  return (data ?? []) as unknown as PublicProjectSummary[];
}

type VerifierClient = ReturnType<typeof publicServerClient>;

export interface AuthContext {
  userId: string;
  supabase: VerifierClient;
  email?: string;
}

/**
 * Signs evidence URLs securely.
 * Rejects arbitrary or external URLs.
 * Verifies that the caller owns the project or holds a verifier/admin role.
 */
export async function signEvidenceUrls(urls: string[], auth?: AuthContext) {
  const admin = await getAdmin();
  const out: Record<string, string | null> = {};

  for (const url of urls) {
    if (!url || typeof url !== "string") {
      continue;
    }

    const match = url.match(EVIDENCE_STORAGE_REGEX);
    if (!match) {
      // SECURITY: Reject arbitrary or external URLs to prevent SSRF and untracked asset spoofing
      out[url] = null;
      continue;
    }

    const projectId = match[1];
    const filePath = match[2];
    if (!projectId || !filePath) {
      out[url] = null;
      continue;
    }

    // If auth context is provided, enforce project ownership or verifier role
    if (auth) {
      const isAuthorized = await checkProjectAccess(auth.supabase, auth.userId, projectId);
      if (!isAuthorized) {
        out[url] = null;
        continue;
      }
    }

    const storagePath = `${projectId}/${filePath}`;
    const { data, error } = await admin.storage.from("evidence").createSignedUrl(storagePath, 3600);
    out[url] = error ? null : (data?.signedUrl ?? null);
  }

  return out;
}

async function checkProjectAccess(
  supabase: VerifierClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  // Check if verifier or admin
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const userRoles = (roles ?? []).map((r) => r.role);
  if (userRoles.includes("verifier") || userRoles.includes("admin")) {
    return true;
  }

  // Otherwise verify project ownership
  const { data: project } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", projectId)
    .maybeSingle();

  return project?.owner_id === userId;
}

export interface DecisionInput {
  supabase: VerifierClient;
  userId: string;
  verifierEmail: string;
  projectId: string;
  comments?: string | null;
  confirmedCarbon?: number | null;
  expectedStatus?: "SUBMITTED" | "UNDER_REVIEW";
}

async function assertVerifier(supabase: VerifierClient, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(`Role verification failed: ${error.message}`);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("verifier") && !roles.includes("admin")) {
    throw new Error(
      "Unauthorized: Only authorized NCCR verifiers or administrators can record verification decisions.",
    );
  }
}

async function loadProject(supabase: VerifierClient, projectId: string) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw new Error(`Project ${projectId} not found: ${error?.message}`);
  return data;
}

async function logEvent(
  supabase: VerifierClient,
  args: {
    projectId: string;
    projectCode: string;
    actorEmail: string;
    action: string;
    previous: string;
    next: string;
    comments?: string | null;
    timelineLabel?: string;
    timelineDetail?: string;
    notifyEmail?: string;
    notifyTitle?: string;
    notifyBody?: string;
  },
) {
  const { error: auditError } = await supabase.from("audit_logs").insert({
    project_id: args.projectId,
    project_code: args.projectCode,
    actor_email: args.actorEmail,
    action: args.action,
    previous_status: args.previous,
    new_status: args.next,
    comments: args.comments ?? null,
  });
  if (auditError) {
    throw new Error(`Durable audit logging failed: ${auditError.message}`);
  }

  if (args.timelineLabel) {
    const { error: timelineError } = await supabase.from("project_timeline").insert({
      project_id: args.projectId,
      label: args.timelineLabel,
      detail: args.timelineDetail ?? null,
      actor_email: args.actorEmail,
    });
    if (timelineError) {
      console.warn("Timeline recording error:", timelineError.message);
    }
  }

  if (args.notifyEmail && args.notifyTitle) {
    const { error: notifError } = await supabase.from("notifications").insert({
      recipient_email: args.notifyEmail,
      project_id: args.projectId,
      title: args.notifyTitle,
      body: args.notifyBody ?? null,
    });
    if (notifError) {
      console.warn("Notification error:", notifError.message);
    }
  }
}

/** Begins verifier review. Enforces transition from SUBMITTED -> UNDER_REVIEW with optimistic concurrency. */
export async function startReview(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  const project = await loadProject(input.supabase, input.projectId);

  if (project.status !== "SUBMITTED") {
    throw new Error(
      `Cannot begin review: Project status is '${project.status}'. Only projects in 'SUBMITTED' status can be moved to review.`,
    );
  }

  // Optimistic concurrency update
  const { data: updated, error: updateError } = await input.supabase
    .from("projects")
    .update({
      status: "UNDER_REVIEW",
      verifier_id: input.userId,
      verifier_name: input.verifierEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.projectId)
    .eq("status", "SUBMITTED")
    .select();

  if (updateError) throw new Error(`Failed to update project status: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    throw new Error(
      "Concurrency conflict: The project was modified by another user. Please refresh and try again.",
    );
  }

  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Verification started",
    previous: "SUBMITTED",
    next: "UNDER_REVIEW",
    timelineLabel: "NCCR Review",
    timelineDetail: "Verification started by NCCR verifier",
    notifyEmail: project.owner_email,
    notifyTitle: `Verification started for ${project.project_code}`,
    notifyBody: "An NCCR verifier has begun reviewing your project submission.",
  });

  return { status: "UNDER_REVIEW" as const };
}

/** Approves project verification. Enforces UNDER_REVIEW -> VERIFIED_PENDING_ANCHOR -> VERIFIED transition with full audit and blockchain anchoring. */
export async function approveProject(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  const project = await loadProject(input.supabase, input.projectId);

  if (project.status !== "UNDER_REVIEW") {
    throw new Error(
      `Invalid state transition: Cannot approve project in '${project.status}' state. Project must be 'UNDER_REVIEW'.`,
    );
  }

  const verifiedCarbon = Number(input.confirmedCarbon);
  if (!verifiedCarbon || verifiedCarbon <= 0 || Number.isNaN(verifiedCarbon)) {
    throw new Error("Invalid carbon value: Confirmed carbon impact must be a positive number.");
  }

  // 1. Strict Evidence Validation: Check query error, require >= 1 file, enforce cryptographic SHA-256 hash
  const { data: evidence, error: evidenceError } = await input.supabase
    .from("evidence")
    .select("id, file_name, file_hash")
    .eq("project_id", project.id);

  if (evidenceError) {
    throw new Error(`Failed to retrieve project evidence records: ${evidenceError.message}`);
  }

  if (!evidence || evidence.length === 0) {
    throw new Error(
      `Verification approval rejected: Project ${project.project_code} has no uploaded evidence records. At least one verified evidence document is strictly required.`,
    );
  }

  const sha256Regex = /^[a-fA-F0-9]{64}$/;
  const invalidEvidence = evidence.filter((e) => !e.file_hash || !sha256Regex.test(e.file_hash));
  if (invalidEvidence.length > 0) {
    const invalidNames = invalidEvidence.map((e) => e.file_name || e.id).join(", ");
    throw new Error(
      `Verification approval rejected: Evidence records [${invalidNames}] lack valid SHA-256 cryptographic content hashes. Cryptographic proof of file contents is strictly required.`,
    );
  }

  const evidenceHashes = evidence.map((e) => e.file_hash as string);
  const verifiedAt = new Date().toISOString();

  // Canonical payload used for anchoring and stored in outbox as source of truth
  const anchorPayload: AnchorPayload = {
    project_code: project.project_code,
    project_name: project.name,
    ecosystem: project.ecosystem,
    state: project.state,
    district: project.district,
    latitude: project.latitude,
    longitude: project.longitude,
    area_hectares: project.area_hectares == null ? null : Number(project.area_hectares),
    restoration_start: project.restoration_start,
    restoration_end: project.restoration_end,
    verified_tco2e: verifiedCarbon,
    methodology: CARBON_METHODOLOGY_ID,
    evidence_count: evidence.length,
    evidence_hashes: evidenceHashes,
    verifier_id: input.userId,
    verified_at: verifiedAt,
  };

  // 2. Execute atomic database transaction (Stage 1: UNDER_REVIEW -> VERIFIED_PENDING_ANCHOR)
  const supabaseWithRpc = input.supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { data: _atomicResult, error: rpcError } = await supabaseWithRpc.rpc(
    "perform_verification_decision",
    {
      _project_id: project.id,
      _decision: "APPROVE",
      _comments: input.comments ?? null,
      _confirmed_carbon: verifiedCarbon,
      _verifier_id: input.userId,
      _verifier_email: input.verifierEmail,
      _expected_status: "UNDER_REVIEW",
      _anchor_payload: anchorPayload,
    },
  );

  if (rpcError) {
    // Fail closed: Never fall back to partial, non-atomic database writes
    throw new Error(
      `Verification approval failed: atomic database transaction error: ${rpcError.message}`,
    );
  }

  // 3. Anchor verified record on blockchain
  const anchor = await anchorVerifiedRecord(anchorPayload);

  // 4. Handle Blockchain Result & Transition State Durably
  if (anchor.status === "CONFIRMED") {
    // Stage 2 completion: Promote project from VERIFIED_PENDING_ANCHOR to VERIFIED
    // ONLY genuine CONFIRMED on-chain status qualifies for VERIFIED
    const { error: confirmError } = await supabaseWithRpc.rpc("confirm_blockchain_anchor", {
      _project_id: project.id,
      _record_hash: anchor.record_hash,
      _tx_hash: anchor.tx_hash,
      _block_number: anchor.block_number,
      _network: anchor.network,
      _status: "CONFIRMED",
      _verifier_id: input.userId,
      _verified_tco2e: verifiedCarbon,
      _anchored_payload: {
        ...anchorPayload,
        simulated: false,
        explorer_url: anchor.explorer_url ?? null,
        error: anchor.error ?? null,
      },
    });

    if (confirmError) {
      // NEVER ignore database failure to record transaction state!
      throw new Error(
        `Critical database error: Failed to record confirmed blockchain anchor for ${project.project_code}: ${confirmError.message}. State remains VERIFIED_PENDING_ANCHOR for recovery.`,
      );
    }

    return { status: "VERIFIED" as const, verifiedCarbon, anchor };
  }

  if (anchor.status === "SIMULATED") {
    // Demo Mode Simulation: Explicitly records demo simulation in distinct DEMO_SIMULATED status (NEVER VERIFIED)
    const { error: simError } = await supabaseWithRpc.rpc("record_simulated_demo_anchor", {
      _project_id: project.id,
      _record_hash: anchor.record_hash,
      _tx_hash: anchor.tx_hash,
      _verifier_id: input.userId,
      _verified_tco2e: verifiedCarbon,
      _anchored_payload: {
        ...anchorPayload,
        simulated: true,
        explorer_url: null,
      },
    });

    if (simError) {
      throw new Error(
        `Critical database error: Failed to record demo simulation state for ${project.project_code}: ${simError.message}.`,
      );
    }

    return {
      status: "DEMO_SIMULATED" as const,
      verifiedCarbon,
      anchor,
      simulated: true,
    };
  }

  // Anchoring failed or is pending: Record failure in durable outbox, do NOT report as VERIFIED
  const { error: failErr } = await supabaseWithRpc.rpc("record_blockchain_failure", {
    _project_id: project.id,
    _error_message: anchor.error || "Blockchain anchoring did not achieve on-chain confirmation.",
    _verifier_id: input.userId,
  });

  if (failErr) {
    throw new Error(
      `Failed to record blockchain failure state for ${project.project_code}: ${failErr.message}`,
    );
  }

  return {
    status: "VERIFIED_PENDING_ANCHOR" as const,
    verifiedCarbon,
    anchor,
    error: anchor.error || "Blockchain anchoring is pending or failed.",
  };
}

/**
 * Idempotently retries blockchain anchoring for a project in VERIFIED_PENDING_ANCHOR status.
 * Safely claims the durable outbox job with a lease to prevent race conditions and concurrent double-anchoring.
 * Reads the canonical stored outbox payload as the authoritative source of truth.
 * Strictly verifies identity binding and verifies that retry failures are durably persisted.
 */
export async function retryProjectAnchor(
  supabase: VerifierClient,
  projectId: string,
  verifierId: string,
) {
  await assertVerifier(supabase, verifierId);

  // Strict identity binding: authenticated user's ID must match verifierId
  const { data: userRes } = await supabase.auth.getUser();
  if (userRes?.user && userRes.user.id !== verifierId) {
    throw new Error(
      `Caller identity mismatch: auth.uid (${userRes.user.id}) does not match verifierId (${verifierId}).`,
    );
  }

  const project = await loadProject(supabase, projectId);

  if (project.status !== "VERIFIED_PENDING_ANCHOR") {
    throw new Error(
      `Project ${project.project_code} is in status '${project.status}', expected 'VERIFIED_PENDING_ANCHOR'.`,
    );
  }

  const supabaseWithRpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  // 1. Claim outbox job with row-level lock and lease
  const workerId = `retry-verifier-${verifierId}`;
  const { data: claimData, error: claimErr } = await supabaseWithRpc.rpc(
    "claim_project_outbox_job",
    {
      _project_id: projectId,
      _worker_id: workerId,
      _lease_seconds: 60,
    },
  );

  if (claimErr) {
    throw new Error(`Failed to claim outbox job for ${project.project_code}: ${claimErr.message}`);
  }

  const claimedJobs = (claimData as Array<{ id: string; payload: AnchorPayload }>) || [];

  let payload: AnchorPayload;
  let jobId: string | null = null;

  const firstJob = claimedJobs[0];
  if (firstJob) {
    // Authoritative source of truth: stored outbox payload
    jobId = firstJob.id;
    payload = firstJob.payload;
  } else {
    // If no active outbox record found (e.g. legacy row), safely reconstruct from database
    const { data: evidence, error: evidenceError } = await supabase
      .from("evidence")
      .select("file_hash")
      .eq("project_id", project.id);

    if (evidenceError || !evidence || evidence.length === 0) {
      throw new Error(
        `Cannot retry anchor: missing or unreadable evidence for ${project.project_code}`,
      );
    }

    const evidenceHashes = evidence.map((e) => e.file_hash as string);
    const verifiedCarbon = Number(project.verified_carbon || project.estimated_carbon || 0);

    payload = {
      project_code: project.project_code,
      project_name: project.name,
      ecosystem: project.ecosystem,
      state: project.state,
      district: project.district,
      latitude: project.latitude,
      longitude: project.longitude,
      area_hectares: project.area_hectares == null ? null : Number(project.area_hectares),
      restoration_start: project.restoration_start,
      restoration_end: project.restoration_end,
      verified_tco2e: verifiedCarbon,
      methodology: CARBON_METHODOLOGY_ID,
      evidence_count: evidence.length,
      evidence_hashes: evidenceHashes,
      verifier_id: verifierId,
      verified_at: new Date().toISOString(),
    };
  }

  // 2. Submit anchor transaction
  const anchor = await anchorVerifiedRecord(payload);

  // 3. Handle confirmed on-chain finality
  if (anchor.status === "CONFIRMED") {
    const { error: confirmError } = await supabaseWithRpc.rpc("confirm_blockchain_anchor", {
      _project_id: project.id,
      _record_hash: anchor.record_hash,
      _tx_hash: anchor.tx_hash,
      _block_number: anchor.block_number,
      _network: anchor.network,
      _status: "CONFIRMED",
      _verifier_id: verifierId,
      _verified_tco2e: payload.verified_tco2e,
      _anchored_payload: {
        ...payload,
        simulated: false,
        explorer_url: anchor.explorer_url ?? null,
      },
    });

    if (confirmError) throw new Error(`Retry confirmation failed: ${confirmError.message}`);
    return { status: "VERIFIED" as const, anchor };
  }

  // 4. Handle simulated demo mode (never promote to VERIFIED)
  if (anchor.status === "SIMULATED") {
    const { error: simError } = await supabaseWithRpc.rpc("record_simulated_demo_anchor", {
      _project_id: project.id,
      _record_hash: anchor.record_hash,
      _tx_hash: anchor.tx_hash,
      _verifier_id: verifierId,
      _verified_tco2e: payload.verified_tco2e,
      _anchored_payload: {
        ...payload,
        simulated: true,
        explorer_url: null,
      },
    });

    if (simError) throw new Error(`Retry simulation record failed: ${simError.message}`);
    return { status: "DEMO_SIMULATED" as const, anchor, simulated: true };
  }

  // 5. Retry failed: Durably record failure in outbox and audit log. Strictly check for persistence errors.
  const { error: failErr } = await supabaseWithRpc.rpc("record_blockchain_failure", {
    _project_id: project.id,
    _error_message: anchor.error || "Retry failed to achieve confirmation.",
    _verifier_id: verifierId,
  });

  if (failErr) {
    throw new Error(
      `CRITICAL: Failed to durably record retry failure state for ${project.project_code}: ${failErr.message}`,
    );
  }

  if (jobId) {
    const { error: outboxFailErr } = await supabaseWithRpc.rpc("fail_outbox_job", {
      _job_id: jobId,
      _error_message: anchor.error || "Retry failed to achieve confirmation.",
      _retry_delay_seconds: 30,
      _max_attempts: 5,
    });
    if (outboxFailErr) {
      throw new Error(
        `CRITICAL: Failed to update outbox retry state for job ${jobId}: ${outboxFailErr.message}`,
      );
    }
  }

  return { status: "VERIFIED_PENDING_ANCHOR" as const, anchor, error: anchor.error };
}

/**
 * Independent outbox worker function.
 * Safely claims the next pending job using SKIP LOCKED, processes anchoring idempotently
 * from the stored payload, and applies exponential backoff on failure.
 */
export async function processOutboxJob(
  supabase: VerifierClient,
  workerId: string = `worker-${Math.random().toString(36).substring(2, 9)}`,
  leaseSeconds: number = 60,
) {
  const supabaseWithRpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { data: claimData, error: claimErr } = await supabaseWithRpc.rpc("claim_next_outbox_job", {
    _worker_id: workerId,
    _lease_seconds: leaseSeconds,
  });

  if (claimErr) {
    throw new Error(`Outbox worker claim error: ${claimErr.message}`);
  }

  const jobs =
    (claimData as Array<{
      id: string;
      project_id: string;
      payload: AnchorPayload;
      attempts: number;
    }>) || [];
  const firstJob = jobs[0];
  if (!firstJob) {
    return { processed: false, reason: "NO_PENDING_JOBS" as const };
  }

  const job = firstJob;
  const payload = job.payload;

  try {
    const anchor = await anchorVerifiedRecord(payload);

    if (anchor.status === "CONFIRMED") {
      const { error: confirmErr } = await supabaseWithRpc.rpc("confirm_blockchain_anchor", {
        _project_id: job.project_id,
        _record_hash: anchor.record_hash,
        _tx_hash: anchor.tx_hash,
        _block_number: anchor.block_number,
        _network: anchor.network,
        _status: "CONFIRMED",
        _verifier_id: payload.verifier_id,
        _verified_tco2e: payload.verified_tco2e,
        _anchored_payload: {
          ...payload,
          simulated: false,
          explorer_url: anchor.explorer_url ?? null,
        },
      });

      if (confirmErr) throw new Error(`Outbox confirmation error: ${confirmErr.message}`);
      return {
        processed: true,
        status: "VERIFIED" as const,
        jobId: job.id,
        txHash: anchor.tx_hash,
      };
    }

    if (anchor.status === "SIMULATED") {
      const { error: simErr } = await supabaseWithRpc.rpc("record_simulated_demo_anchor", {
        _project_id: job.project_id,
        _record_hash: anchor.record_hash,
        _tx_hash: anchor.tx_hash,
        _verifier_id: payload.verifier_id,
        _verified_tco2e: payload.verified_tco2e,
        _anchored_payload: {
          ...payload,
          simulated: true,
          explorer_url: null,
        },
      });

      if (simErr) throw new Error(`Outbox simulation record error: ${simErr.message}`);
      return { processed: true, status: "DEMO_SIMULATED" as const, jobId: job.id };
    }

    // Anchoring failed: apply exponential backoff
    const delay = Math.min(300, 30 * Math.pow(2, job.attempts - 1));
    const { error: failErr } = await supabaseWithRpc.rpc("fail_outbox_job", {
      _job_id: job.id,
      _error_message: anchor.error || "Anchoring attempt failed.",
      _retry_delay_seconds: delay,
      _max_attempts: 5,
    });

    if (failErr) throw new Error(`Failed to record outbox failure: ${failErr.message}`);
    return {
      processed: true,
      status: "PENDING_RETRY" as const,
      jobId: job.id,
      retryDelaySeconds: delay,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await supabaseWithRpc.rpc("fail_outbox_job", {
      _job_id: job.id,
      _error_message: errorMsg,
      _retry_delay_seconds: 60,
      _max_attempts: 5,
    });
    throw err;
  }
}

/** Requests correction. Enforces UNDER_REVIEW -> CORRECTION_REQUIRED transition atomically with mandatory comments. */
export async function requestCorrection(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  if (!input.comments?.trim() || input.comments.trim().length < 5) {
    throw new Error(
      "Verifier comments (minimum 5 characters) are required to request a correction.",
    );
  }

  const project = await loadProject(input.supabase, input.projectId);
  if (project.status !== "UNDER_REVIEW") {
    throw new Error(
      `Cannot request correction: Project status is '${project.status}', expected 'UNDER_REVIEW'.`,
    );
  }

  const supabaseWithRpc = input.supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { error: rpcError } = await supabaseWithRpc.rpc("perform_verification_decision", {
    _project_id: project.id,
    _decision: "REQUEST_CORRECTION",
    _comments: input.comments.trim(),
    _confirmed_carbon: null,
    _verifier_id: input.userId,
    _verifier_email: input.verifierEmail,
    _expected_status: "UNDER_REVIEW",
  });

  if (rpcError) {
    throw new Error(
      `Correction request failed: atomic database transaction error: ${rpcError.message}`,
    );
  }

  return { status: "CORRECTION_REQUIRED" as const };
}

/** Rejects project. Enforces UNDER_REVIEW or SUBMITTED -> REJECTED transition atomically with mandatory comments. */
export async function rejectProject(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  if (!input.comments?.trim() || input.comments.trim().length < 5) {
    throw new Error("Verifier comments (minimum 5 characters) are required to reject a project.");
  }

  const project = await loadProject(input.supabase, input.projectId);
  if (project.status !== "UNDER_REVIEW" && project.status !== "SUBMITTED") {
    throw new Error(`Cannot reject project in '${project.status}' state.`);
  }

  const supabaseWithRpc = input.supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { error: rpcError } = await supabaseWithRpc.rpc("perform_verification_decision", {
    _project_id: project.id,
    _decision: "REJECT",
    _comments: input.comments.trim(),
    _confirmed_carbon: null,
    _verifier_id: input.userId,
    _verifier_email: input.verifierEmail,
    _expected_status: project.status,
  });

  if (rpcError) {
    throw new Error(
      `Project rejection failed: atomic database transaction error: ${rpcError.message}`,
    );
  }

  return { status: "REJECTED" as const };
}
