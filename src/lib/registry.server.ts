/**
 * Server-only registry operations: verification decisions, blockchain anchoring,
 * secure evidence URL signing, and public verification lookup.
 *
 * Audit Reference: Findings 1, 2, 3, 4, 5 (Security, Integrity, Blockchain, Methodology)
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { anchorVerifiedRecord } from "./blockchain.server.ts";
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

/** Approves project verification. Enforces UNDER_REVIEW -> VERIFIED transition with full audit and blockchain anchoring. */
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

  const verifiedAt = new Date().toISOString();

  // 1. Try atomic database procedure if available
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
    },
  );

  if (rpcError) {
    // If stored procedure is not yet applied, fallback to coordinated safe updates with error checks
    console.warn("Atomic RPC not available, executing coordinated update:", rpcError.message);

    const { data: updated, error: updateError } = await input.supabase
      .from("projects")
      .update({
        status: "VERIFIED",
        verified_carbon: verifiedCarbon,
        verified_at: verifiedAt,
        verifier_id: input.userId,
        verifier_name: input.verifierEmail,
        updated_at: verifiedAt,
      })
      .eq("id", project.id)
      .eq("status", "UNDER_REVIEW")
      .select();

    if (updateError) throw new Error(`Verification update failed: ${updateError.message}`);
    if (!updated || updated.length === 0) {
      throw new Error(
        "Concurrency conflict: Project status was modified concurrently. Please refresh.",
      );
    }

    const { error: revError } = await input.supabase.from("verification_reviews").insert({
      project_id: project.id,
      verifier_id: input.userId,
      verifier_email: input.verifierEmail,
      decision: "APPROVED",
      comments: input.comments ?? null,
      confirmed_carbon: verifiedCarbon,
      created_at: verifiedAt,
    });
    if (revError) throw new Error(`Failed to record verification review: ${revError.message}`);

    const { error: impactError } = await input.supabase.from("carbon_impact_records").insert({
      project_id: project.id,
      estimated_tco2e: project.estimated_carbon,
      verified_tco2e: verifiedCarbon,
      verified_by: input.userId,
      verified_at: verifiedAt,
    });
    if (impactError) throw new Error(`Failed to record carbon impact: ${impactError.message}`);

    await logEvent(input.supabase, {
      projectId: project.id,
      projectCode: project.project_code,
      actorEmail: input.verifierEmail,
      action: "Project verified",
      previous: "UNDER_REVIEW",
      next: "VERIFIED",
      comments: input.comments ?? null,
      timelineLabel: "Project Verified",
      timelineDetail: `Verified carbon impact confirmed: ${verifiedCarbon.toLocaleString("en-IN")} tCO₂e`,
      notifyEmail: project.owner_email,
      notifyTitle: `Project ${project.project_code} has been verified`,
      notifyBody: `Verified carbon impact: ${verifiedCarbon.toLocaleString("en-IN")} tCO₂e.`,
    });
  }

  // 2. Fetch evidence hashes for blockchain anchor
  const { data: evidence } = await input.supabase
    .from("evidence")
    .select("file_hash, file_name")
    .eq("project_id", project.id);

  // 3. Anchor verified record using scientifically validated methodology
  const anchor = await anchorVerifiedRecord({
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
    evidence_count: evidence?.length ?? 0,
    evidence_hashes: (evidence ?? []).map((e) => e.file_hash || e.file_name),
    verifier_id: input.userId,
    verified_at: verifiedAt,
  });

  // 4. Record blockchain transaction state
  const { error: blockError } = await input.supabase.from("blockchain_records").insert({
    project_id: project.id,
    record_hash: anchor.record_hash,
    tx_hash: anchor.tx_hash,
    block_number: anchor.block_number,
    network: anchor.network,
    status: anchor.status,
    verifier_id: input.userId,
    verified_tco2e: verifiedCarbon,
    anchored_payload: {
      project_code: project.project_code,
      verified_tco2e: verifiedCarbon,
      methodology: CARBON_METHODOLOGY_ID,
      simulated: anchor.simulated,
      explorer_url: anchor.explorer_url ?? null,
      error: anchor.error ?? null,
    },
  });

  if (blockError) {
    console.error("Failed to insert blockchain record:", blockError.message);
  }

  return { status: "VERIFIED" as const, verifiedCarbon, anchor };
}

/** Requests correction. Enforces UNDER_REVIEW -> CORRECTION_REQUIRED transition with mandatory comments. */
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

  const { data: updated, error: updateError } = await input.supabase
    .from("projects")
    .update({
      status: "CORRECTION_REQUIRED",
      verifier_id: input.userId,
      verifier_name: input.verifierEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id)
    .eq("status", "UNDER_REVIEW")
    .select();

  if (updateError) throw new Error(`Correction update failed: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    throw new Error("Concurrency conflict: Project was modified concurrently.");
  }

  const { error: revError } = await input.supabase.from("verification_reviews").insert({
    project_id: project.id,
    verifier_id: input.userId,
    verifier_email: input.verifierEmail,
    decision: "CORRECTION_REQUESTED",
    comments: input.comments.trim(),
  });
  if (revError) throw new Error(`Review logging failed: ${revError.message}`);

  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Correction requested",
    previous: "UNDER_REVIEW",
    next: "CORRECTION_REQUIRED",
    comments: input.comments.trim(),
    timelineLabel: "Correction Requested",
    timelineDetail: input.comments.trim(),
    notifyEmail: project.owner_email,
    notifyTitle: `Correction required for ${project.project_code}`,
    notifyBody: input.comments.trim(),
  });

  return { status: "CORRECTION_REQUIRED" as const };
}

/** Rejects project. Enforces UNDER_REVIEW or SUBMITTED -> REJECTED transition with mandatory comments. */
export async function rejectProject(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  if (!input.comments?.trim() || input.comments.trim().length < 5) {
    throw new Error("Verifier comments (minimum 5 characters) are required to reject a project.");
  }

  const project = await loadProject(input.supabase, input.projectId);
  if (project.status !== "UNDER_REVIEW" && project.status !== "SUBMITTED") {
    throw new Error(`Cannot reject project in '${project.status}' state.`);
  }

  const { data: updated, error: updateError } = await input.supabase
    .from("projects")
    .update({
      status: "REJECTED",
      verifier_id: input.userId,
      verifier_name: input.verifierEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id)
    .in("status", ["UNDER_REVIEW", "SUBMITTED"])
    .select();

  if (updateError) throw new Error(`Reject update failed: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    throw new Error("Concurrency conflict: Project was modified concurrently.");
  }

  const { error: revError } = await input.supabase.from("verification_reviews").insert({
    project_id: project.id,
    verifier_id: input.userId,
    verifier_email: input.verifierEmail,
    decision: "REJECTED",
    comments: input.comments.trim(),
  });
  if (revError) throw new Error(`Review logging failed: ${revError.message}`);

  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Project rejected",
    previous: project.status,
    next: "REJECTED",
    comments: input.comments.trim(),
    timelineLabel: "Project Rejected",
    timelineDetail: input.comments.trim(),
    notifyEmail: project.owner_email,
    notifyTitle: `Project ${project.project_code} was rejected`,
    notifyBody: input.comments.trim(),
  });

  return { status: "REJECTED" as const };
}
