/**
 * Server-only registry helpers: verification decisions, blockchain anchoring,
 * public verification lookup and demo account provisioning.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { anchorVerifiedRecord } from "./blockchain.server";
import type { PublicProjectPayload, PublicProjectSummary } from "./public-types";

export const DEMO_ACCOUNTS = [
  {
    email: "owner@bluecarbon.demo",
    password: "bluecarbon123",
    role: "project_owner",
    full_name: "Demo Project Owner",
    organization: "Coastal Green Foundation",
    phone: "+91 90000 00001",
  },
  {
    email: "verifier@nccr.demo",
    password: "bluecarbon123",
    role: "verifier",
    full_name: "NCCR Verifier",
    organization: "National Centre for Coastal Research",
    phone: "+91 90000 00002",
  },
] as const;

export function publicServerClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const STORAGE_PREFIX = "storage://";

async function signStoredUrls(
  admin: Awaited<ReturnType<typeof getAdmin>>,
  items: { file_url?: string | null }[],
) {
  for (const item of items) {
    if (item.file_url?.startsWith(STORAGE_PREFIX)) {
      const path = item.file_url.slice(STORAGE_PREFIX.length);
      const { data } = await admin.storage.from("evidence").createSignedUrl(path, 60 * 60);
      item.file_url = data?.signedUrl ?? null;
    }
  }
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Public (no auth) verification lookup — PII is stripped by the database function. */
export async function fetchPublicProject(code: string): Promise<PublicProjectPayload | null> {
  const client = publicServerClient();
  const { data, error } = await client.rpc("get_public_project", { _code: code });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const payload = data as unknown as PublicProjectPayload;
  const admin = await getAdmin();
  await signStoredUrls(admin, payload.evidence ?? []);
  return payload;
}

export async function fetchPublicProjects(): Promise<PublicProjectSummary[]> {
  const client = publicServerClient();
  const { data, error } = await client.rpc("list_public_projects");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PublicProjectSummary[];
}

/** Signed URLs for evidence files, for authenticated viewers. */
export async function signEvidenceUrls(urls: string[]) {
  const admin = await getAdmin();
  const out: Record<string, string | null> = {};
  for (const url of urls) {
    if (!url.startsWith(STORAGE_PREFIX)) {
      out[url] = url;
      continue;
    }
    const { data } = await admin.storage
      .from("evidence")
      .createSignedUrl(url.slice(STORAGE_PREFIX.length), 60 * 60);
    out[url] = data?.signedUrl ?? null;
  }
  return out;
}

export async function ensureDemoAccounts() {
  const admin = await getAdmin();
  const results: { email: string; created: boolean }[] = [];
  for (const account of DEMO_ACCOUNTS) {
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", account.email)
      .maybeSingle();
    if (existing) {
      results.push({ email: account.email, created: false });
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: {
        full_name: account.full_name,
        organization: account.organization,
        phone: account.phone,
        role: account.role,
      },
    });
    if (error && !/already/i.test(error.message)) throw new Error(error.message);
    const userId = data?.user?.id;
    if (userId) {
      await admin.from("user_roles").upsert(
        { user_id: userId, role: account.role as Database["public"]["Enums"]["app_role"] },
        { onConflict: "user_id,role" },
      );
      if (account.role === "project_owner") {
        // Attach the seeded demonstration projects to the demo owner account.
        await admin.from("projects").update({ owner_id: userId }).eq("owner_email", account.email);
      }
    }
    results.push({ email: account.email, created: true });
  }
  return results;
}

type VerifierClient = ReturnType<typeof publicServerClient>;

interface DecisionInput {
  supabase: VerifierClient;
  userId: string;
  verifierEmail: string;
  projectId: string;
  comments?: string | null;
  confirmedCarbon?: number | null;
}

async function assertVerifier(supabase: VerifierClient, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("verifier") && !roles.includes("admin")) {
    throw new Error("Only NCCR verifiers can record verification decisions.");
  }
}

async function loadProject(supabase: VerifierClient, projectId: string) {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error) throw new Error(error.message);
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
  await supabase.from("audit_logs").insert({
    project_id: args.projectId,
    project_code: args.projectCode,
    actor_email: args.actorEmail,
    action: args.action,
    previous_status: args.previous,
    new_status: args.next,
    comments: args.comments ?? null,
  });
  if (args.timelineLabel) {
    await supabase.from("project_timeline").insert({
      project_id: args.projectId,
      label: args.timelineLabel,
      detail: args.timelineDetail ?? null,
      actor_email: args.actorEmail,
    });
  }
  if (args.notifyEmail && args.notifyTitle) {
    await supabase.from("notifications").insert({
      recipient_email: args.notifyEmail,
      project_id: args.projectId,
      title: args.notifyTitle,
      body: args.notifyBody ?? null,
    });
  }
}

export async function startReview(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  const project = await loadProject(input.supabase, input.projectId);
  if (project.status !== "SUBMITTED") return { status: project.status };
  await input.supabase
    .from("projects")
    .update({ status: "UNDER_REVIEW", verifier_id: input.userId, verifier_name: input.verifierEmail })
    .eq("id", input.projectId);
  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Verification started",
    previous: project.status,
    next: "UNDER_REVIEW",
    timelineLabel: "NCCR Review",
    timelineDetail: "Verification started by NCCR verifier",
    notifyEmail: project.owner_email,
    notifyTitle: `Verification started for ${project.project_code}`,
    notifyBody: "An NCCR verifier has begun reviewing your project submission.",
  });
  return { status: "UNDER_REVIEW" as const };
}

export async function approveProject(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  const project = await loadProject(input.supabase, input.projectId);
  if (project.status === "VERIFIED") throw new Error("Project is already verified.");
  const verifiedCarbon =
    input.confirmedCarbon != null && input.confirmedCarbon > 0
      ? input.confirmedCarbon
      : Number(project.estimated_carbon ?? 0);
  const verifiedAt = new Date().toISOString();

  const { data: evidence } = await input.supabase
    .from("evidence")
    .select("file_hash, file_name")
    .eq("project_id", project.id);

  await input.supabase
    .from("projects")
    .update({
      status: "VERIFIED",
      verified_carbon: verifiedCarbon,
      verified_at: verifiedAt,
      verifier_id: input.userId,
      verifier_name: input.verifierEmail,
    })
    .eq("id", project.id);

  await input.supabase.from("verification_reviews").insert({
    project_id: project.id,
    verifier_id: input.userId,
    verifier_email: input.verifierEmail,
    decision: "APPROVED",
    comments: input.comments ?? null,
    confirmed_carbon: verifiedCarbon,
  });

  await input.supabase.from("carbon_impact_records").insert({
    project_id: project.id,
    estimated_tco2e: project.estimated_carbon,
    verified_tco2e: verifiedCarbon,
    verified_by: input.userId,
    verified_at: verifiedAt,
  });

  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Project verified",
    previous: project.status,
    next: "VERIFIED",
    comments: input.comments ?? null,
    timelineLabel: "Project Verified",
    timelineDetail: `Verified carbon impact confirmed: ${verifiedCarbon.toLocaleString("en-IN")} tCO₂e`,
    notifyEmail: project.owner_email,
    notifyTitle: `Project ${project.project_code} has been verified.`,
    notifyBody: `Verified carbon impact: ${verifiedCarbon.toLocaleString("en-IN")} tCO₂e.`,
  });

  // Anchor a tamper-evident hash of the canonical verified record.
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
    methodology: "DEMONSTRATION_COEFFICIENTS_V1",
    evidence_count: evidence?.length ?? 0,
    evidence_hashes: (evidence ?? []).map((e) => e.file_hash || e.file_name),
    verifier_id: input.userId,
    verified_at: verifiedAt,
  });

  await input.supabase.from("blockchain_records").insert({
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
      methodology: "DEMONSTRATION_COEFFICIENTS_V1",
      simulated: anchor.simulated,
    },
  });

  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Blockchain record created",
    previous: "VERIFIED",
    next: "VERIFIED",
    timelineLabel: "Blockchain Record Created",
    timelineDetail: `Record hash anchored on ${anchor.network}`,
    notifyEmail: project.owner_email,
    notifyTitle: `Blockchain proof created for ${project.project_code}`,
    notifyBody: `Transaction ${anchor.tx_hash.slice(0, 12)}… on ${anchor.network}.`,
  });

  return { status: "VERIFIED" as const, verifiedCarbon, anchor };
}

export async function requestCorrection(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  if (!input.comments?.trim()) throw new Error("Verifier comments are required to request a correction.");
  const project = await loadProject(input.supabase, input.projectId);
  await input.supabase
    .from("projects")
    .update({ status: "CORRECTION_REQUIRED", verifier_id: input.userId, verifier_name: input.verifierEmail })
    .eq("id", project.id);
  await input.supabase.from("verification_reviews").insert({
    project_id: project.id,
    verifier_id: input.userId,
    verifier_email: input.verifierEmail,
    decision: "CORRECTION_REQUESTED",
    comments: input.comments,
  });
  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Correction requested",
    previous: project.status,
    next: "CORRECTION_REQUIRED",
    comments: input.comments,
    timelineLabel: "Correction Requested",
    timelineDetail: input.comments,
    notifyEmail: project.owner_email,
    notifyTitle: `Correction required for ${project.project_code}`,
    notifyBody: input.comments,
  });
  return { status: "CORRECTION_REQUIRED" as const };
}

export async function rejectProject(input: DecisionInput) {
  await assertVerifier(input.supabase, input.userId);
  if (!input.comments?.trim()) throw new Error("Verifier comments are required to reject a project.");
  const project = await loadProject(input.supabase, input.projectId);
  await input.supabase
    .from("projects")
    .update({ status: "REJECTED", verifier_id: input.userId, verifier_name: input.verifierEmail })
    .eq("id", project.id);
  await input.supabase.from("verification_reviews").insert({
    project_id: project.id,
    verifier_id: input.userId,
    verifier_email: input.verifierEmail,
    decision: "REJECTED",
    comments: input.comments,
  });
  await logEvent(input.supabase, {
    projectId: project.id,
    projectCode: project.project_code,
    actorEmail: input.verifierEmail,
    action: "Project rejected",
    previous: project.status,
    next: "REJECTED",
    comments: input.comments,
    timelineLabel: "Project Rejected",
    timelineDetail: input.comments,
    notifyEmail: project.owner_email,
    notifyTitle: `Project ${project.project_code} was rejected`,
    notifyBody: input.comments,
  });
  return { status: "REJECTED" as const };
}
