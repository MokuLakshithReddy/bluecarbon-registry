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
import { EVIDENCE_STORAGE_REGEX, resolveEvidenceStoragePath } from "./evidence-storage-path.ts";
import { verifyEvidenceProvenance } from "./evidence-validator.ts";
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

  // Filter out any evidence items not explicitly marked as public (fail-closed)
  if (payload.evidence && Array.isArray(payload.evidence)) {
    payload.evidence = payload.evidence.filter(
      (e) => (e as { is_public?: boolean }).is_public === true,
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

export type VerifierClient = ReturnType<typeof publicServerClient>;

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
  processOutboxInline?: boolean;
}

async function assertVerifier(supabase: VerifierClient, userId: string, targetEcosystem?: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(`Role verification failed: ${error.message}`);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("verifier") && !roles.includes("admin")) {
    throw new Error(
      "Unauthorized: Only authorized NCCR verifiers or administrators can record verification decisions.",
    );
  }

  // Cross-check persistent trust registry (enrolled_verifiers)
  try {
    const { data: verifierRecord, error: enrollError } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  status?: string;
                  authorized_biomes?: string[];
                  accreditation_expires_at?: string | null;
                } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )
      .from("enrolled_verifiers")
      .select("status, authorized_biomes, accreditation_expires_at")
      .eq("verifier_id", userId)
      .maybeSingle();

    if (!enrollError && verifierRecord) {
      if (verifierRecord.status === "REVOKED") {
        throw new Error(
          "Unauthorized: Verifier accreditation has been revoked in the trust registry.",
        );
      }
      if (verifierRecord.status === "SUSPENDED") {
        throw new Error(
          "Unauthorized: Verifier accreditation is currently suspended in the trust registry.",
        );
      }
      if (
        verifierRecord.accreditation_expires_at &&
        new Date(verifierRecord.accreditation_expires_at).getTime() < Date.now()
      ) {
        throw new Error(
          "Unauthorized: Verifier professional accreditation has expired in the trust registry.",
        );
      }
      if (
        targetEcosystem &&
        verifierRecord.authorized_biomes &&
        !verifierRecord.authorized_biomes.includes(targetEcosystem)
      ) {
        throw new Error(
          `Unauthorized: Verifier is not accredited for '${targetEcosystem}' ecosystems in the trust registry.`,
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Unauthorized:")) {
      throw err;
    }
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
  const project = await loadProject(input.supabase, input.projectId);
  await assertVerifier(input.supabase, input.userId, project.ecosystem);

  if (project.status !== "UNDER_REVIEW") {
    throw new Error(
      `Invalid state transition: Cannot approve project in '${project.status}' state. Project must be 'UNDER_REVIEW'.`,
    );
  }

  const verifiedCarbon = Number(input.confirmedCarbon);
  if (!verifiedCarbon || verifiedCarbon <= 0 || Number.isNaN(verifiedCarbon)) {
    throw new Error("Invalid carbon value: Confirmed carbon impact must be a positive number.");
  }

  // 1. Strict Evidence Validation & Provenance Check
  const { data: evidence, error: evidenceError } = await input.supabase
    .from("evidence")
    .select("id, file_name, file_hash, file_url")
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

  // 1b. Provenance Verification: Fail-closed byte-level cryptographic integrity check
  type EvidenceStorageClient = {
    from(bucket: string): {
      download(
        path: string,
      ): Promise<{ data: Blob | Uint8Array | null; error: { message: string } | null }>;
    };
  };

  let storageClient: EvidenceStorageClient | null = null;
  try {
    const admin = await getAdmin();
    if (
      admin &&
      "storage" in admin &&
      (admin as unknown as { storage: EvidenceStorageClient }).storage
    ) {
      storageClient = (admin as unknown as { storage: EvidenceStorageClient }).storage;
    }
  } catch {
    // Admin client unavailable; fallback to input.supabase storage if provided
  }
  if (
    !storageClient &&
    input.supabase &&
    "storage" in input.supabase &&
    (input.supabase as unknown as { storage: EvidenceStorageClient }).storage
  ) {
    storageClient = (input.supabase as unknown as { storage: EvidenceStorageClient }).storage;
  }

  if (!storageClient) {
    throw new Error(
      "Verification approval rejected: Evidence storage client is unavailable for provenance verification.",
    );
  }

  for (const item of evidence) {
    const evidenceName = item.file_name || item.id || "unnamed evidence";

    const fileUrl = item.file_url?.trim() ?? "";

    // Delegate to the shared, tested path resolver.
    // All scheme checking, cross-project ownership binding, UUID validation,
    // traversal rejection, and path normalization live in evidence-storage-path.ts.
    const resolved = resolveEvidenceStoragePath(fileUrl, project.id, evidenceName);
    if (resolved.error) {
      throw new Error(`Verification approval rejected: ${resolved.error}`);
    }
    const storagePath = resolved.storagePath!;

    const { data: fileBlob, error: downloadError } = await storageClient
      .from("evidence")
      .download(storagePath);

    if (downloadError) {
      throw new Error(
        `Verification approval rejected: Unable to retrieve evidence file "${evidenceName}" from storage for provenance verification: ${downloadError.message}`,
      );
    }

    if (!fileBlob) {
      throw new Error(
        `Verification approval rejected: Evidence storage object "${storagePath}" for "${evidenceName}" returned no file data.`,
      );
    }

    const bytes: Uint8Array =
      fileBlob instanceof Uint8Array ? fileBlob : new Uint8Array(await fileBlob.arrayBuffer());

    if (bytes.byteLength === 0) {
      throw new Error(
        `Verification approval rejected: Evidence file "${evidenceName}" from storage is empty (0 bytes).`,
      );
    }

    const provenance = verifyEvidenceProvenance(bytes, item.file_hash!);
    if (!provenance.valid) {
      throw new Error(
        `Verification approval rejected: Evidence provenance check failed for "${evidenceName}". ${provenance.error}`,
      );
    }
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

  // 2. Execute atomic database transaction (Stage 1: UNDER_REVIEW -> VERIFIED_PENDING_ANCHOR + outbox)
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

  // If processOutboxInline is explicitly requested (e.g. in synchronous test/demo harnesses)
  if (input.processOutboxInline) {
    return await retryProjectAnchor(input.supabase, project.id, input.userId);
  }

  // 3. Reliable durable outbox handoff: The verification decision is atomically committed.
  // The separately operated outbox worker runtime claims the persisted outbox payload,
  // submits the blockchain transaction, verifies on-chain finality, and updates project status.
  return {
    status: "VERIFIED_PENDING_ANCHOR" as const,
    verifiedCarbon,
    outboxJobCreated: true,
    message: `Project ${project.project_code} approved. Verification decision committed. Blockchain anchoring queued in durable outbox for worker processing.`,
  };
}

/**
 * Processes a claimed outbox job using the stored payload as canonical source of truth.
 * Enforces idempotency (detects already confirmed on-chain records) and exponential backoff retry.
 */
export async function processClaimedOutboxJob(
  supabase: VerifierClient,
  job: { id: string; project_id: string; payload: AnchorPayload; attempts: number },
  workerId: string,
) {
  const supabaseWithRpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const payload = job.payload;

  // 1. Idempotency Check & Cleanup: Verify if project is already verified and record already exists
  const { data: project } = await supabase
    .from("projects")
    .select("status, verified_carbon")
    .eq("id", job.project_id)
    .single();

  if (project?.status === "VERIFIED") {
    // Explicitly mark claimed outbox job complete to clean up the queue
    const { data: existingRec } = await supabase
      .from("blockchain_records")
      .select("tx_hash, record_hash")
      .eq("project_id", job.project_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: completeErr } = await supabaseWithRpc.rpc("complete_outbox_job", {
      _job_id: job.id,
      _tx_hash: existingRec?.tx_hash ?? null,
      _record_hash: existingRec?.record_hash ?? null,
    });

    if (completeErr) {
      throw new Error(
        `Idempotency cleanup failed: could not complete outbox job ${job.id} for verified project: ${completeErr.message}`,
      );
    }

    return {
      processed: true,
      status: "VERIFIED" as const,
      jobId: job.id,
      alreadyVerified: true,
      txHash: existingRec?.tx_hash,
    };
  }

  try {
    // 2. Submit anchor transaction using stored outbox payload as source of truth
    const anchor = await anchorVerifiedRecord(payload);

    // 3. Handle CONFIRMED on-chain finality
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

      // Complete outbox job explicitly to clear lease, transition status, and bind verified tx_hash
      const { error: completeErr } = await supabaseWithRpc.rpc("complete_outbox_job", {
        _job_id: job.id,
        _tx_hash: anchor.tx_hash,
        _record_hash: anchor.record_hash,
      });

      if (completeErr) throw new Error(`Outbox completion error: ${completeErr.message}`);

      return {
        processed: true,
        status: "VERIFIED" as const,
        jobId: job.id,
        txHash: anchor.tx_hash,
      };
    }

    // 4. Handle SIMULATED demo mode
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

    // 5. Anchoring failed: Durably record failure in outbox with exponential backoff
    const { error: failErr } = await supabaseWithRpc.rpc("fail_outbox_job", {
      _job_id: job.id,
      _error_message: anchor.error || "Anchoring attempt failed to achieve on-chain confirmation.",
      _base_delay_seconds: 30,
      _max_attempts: 5,
    });

    if (failErr) throw new Error(`Failed to record outbox failure: ${failErr.message}`);
    return {
      processed: true,
      status: "PENDING_RETRY" as const,
      jobId: job.id,
      error: anchor.error,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const { error: failErr } = await supabaseWithRpc.rpc("fail_outbox_job", {
      _job_id: job.id,
      _error_message: errorMsg,
      _base_delay_seconds: 30,
      _max_attempts: 5,
    });
    if (failErr) {
      throw new Error(
        `Outbox job execution failed (${errorMsg}), and recording failure in outbox also failed (${failErr.message})`,
      );
    }
    throw err;
  }
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
  forceRetryFailed: boolean = false,
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

  if (project.status !== "VERIFIED_PENDING_ANCHOR" && project.status !== "VERIFIED") {
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

  // 1. Claim outbox job with row-level lock, lease, and retry backoff enforcement
  const workerId = `retry-verifier-${verifierId}`;
  const { data: claimData, error: claimErr } = await supabaseWithRpc.rpc(
    "claim_project_outbox_job",
    {
      _project_id: projectId,
      _worker_id: workerId,
      _lease_seconds: 60,
      _max_attempts: 5,
      _force_retry_failed: forceRetryFailed,
    },
  );

  if (claimErr) {
    throw new Error(`Failed to claim outbox job for ${project.project_code}: ${claimErr.message}`);
  }

  const claimedJobs =
    (claimData as Array<{
      id: string;
      project_id: string;
      payload: AnchorPayload;
      attempts: number;
    }>) || [];
  const firstJob = claimedJobs[0];

  if (!firstJob) {
    throw new Error(
      `Cannot process anchor retry: No claimable outbox job found for ${project.project_code}. The job may be actively leased, in exponential backoff delay, or reached terminal failure.`,
    );
  }

  // 2. Process using authoritative stored payload
  return await processClaimedOutboxJob(supabase, firstJob, workerId);
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
    _max_attempts: 5,
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

  return await processClaimedOutboxJob(supabase, firstJob, workerId);
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
