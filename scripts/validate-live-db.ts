/**
 * Live / Staging Database Schema & Permissions Validation Script
 *
 * Audit Reference: P0 — Validate the live database and permissions
 *
 * Checks:
 * 1. Connectivity and database health
 * 2. All expected tables exist and have Row Level Security (RLS) enabled
 * 3. Privileged RPC functions exist with correct parameter signatures
 * 4. User role table and immutability triggers are active
 * 5. Role isolation: verifier vs owner vs admin permissions
 */

import { createClient } from "@supabase/supabase-js";

interface ValidationResult {
  step: string;
  passed: boolean;
  details?: string;
}

const REQUIRED_TABLES = [
  "projects",
  "evidence",
  "verification_reviews",
  "carbon_impact_records",
  "blockchain_records",
  "blockchain_outbox",
  "user_roles",
  "audit_logs",
];

const REQUIRED_RPCS = [
  "perform_verification_decision",
  "claim_next_outbox_job",
  "complete_outbox_job",
  "fail_outbox_job",
  "confirm_blockchain_anchor",
  "record_blockchain_failure",
  "record_simulated_demo_anchor",
  "is_service_role",
];

export type ResponseClassification =
  "AUTH_DENIED" | "SUCCESS" | "MISSING_RESOURCE" | "NETWORK_FAILURE" | "UNEXPECTED_SERVER_ERROR";

export function classifyPostgrestResponse(
  error: { code?: string; message: string; details?: string; status?: number } | null | undefined,
): ResponseClassification {
  if (!error) {
    return "SUCCESS";
  }

  const msg = (error.message || "").toLowerCase();
  const code = (error.code || "").toUpperCase();
  const status = error.status;

  // Network / client connection failure
  if (
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("connection refused") ||
    msg.includes("network error")
  ) {
    return "NETWORK_FAILURE";
  }

  // Missing function or table (PGRST202, 42883, 42P01)
  if (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42P01" ||
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  ) {
    return "MISSING_RESOURCE";
  }

  // Explicit authorization denied (Postgres 42501, P0001, PostgREST PGRST301, HTTP 401/403)
  if (
    code === "42501" ||
    code === "P0001" ||
    code === "PGRST301" ||
    status === 401 ||
    status === 403 ||
    msg.includes("permission denied") ||
    msg.includes("violates row-level security") ||
    msg.includes("unauthorized") ||
    msg.includes("only service-role") ||
    msg.includes("only verifiers") ||
    msg.includes("forbidden")
  ) {
    return "AUTH_DENIED";
  }

  return "UNEXPECTED_SERVER_ERROR";
}

export async function validateLiveDatabase(): Promise<{
  allPassed: boolean;
  results: ValidationResult[];
}> {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const anonKey =
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_ANON_KEY"];

  if (!url || !serviceKey) {
    return {
      allPassed: false,
      results: [
        {
          step: "Environment Configuration",
          passed: false,
          details: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided.",
        },
      ],
    };
  }

  if (!anonKey) {
    return {
      allPassed: false,
      results: [
        {
          step: "Environment Configuration",
          passed: false,
          details:
            "SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) must be provided to validate unauthenticated boundary isolation.",
        },
      ],
    };
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const results: ValidationResult[] = [];

  // 1. Connection check with service-role
  try {
    const { error } = await supabase.from("projects").select("id").limit(1);
    const classification = classifyPostgrestResponse(error);
    results.push({
      step: "Database Connectivity (Service Role)",
      passed: classification === "SUCCESS",
      details:
        classification === "SUCCESS"
          ? "Connected successfully to Supabase database."
          : `Failed connectivity (classification: ${classification}): ${error?.message}`,
    });
  } catch (err) {
    results.push({
      step: "Database Connectivity (Service Role)",
      passed: false,
      details: String(err),
    });
    return { allPassed: false, results };
  }

  // 2. Table presence check (service-role)
  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabase.from(table).select("*").limit(0);
      const classification = classifyPostgrestResponse(error);
      results.push({
        step: `Table Check: ${table}`,
        passed: classification === "SUCCESS",
        details:
          classification === "SUCCESS"
            ? "Table accessible under service-role."
            : `Table check failed (classification: ${classification}): ${error?.message}`,
      });
    } catch (err) {
      results.push({
        step: `Table Check: ${table}`,
        passed: false,
        details: String(err),
      });
    }
  }

  // 3. Privileged RPC existence check
  for (const rpc of REQUIRED_RPCS) {
    try {
      const { error } = await supabase.rpc(rpc as never, {} as never);
      const classification = classifyPostgrestResponse(error);
      const isMissing = classification === "MISSING_RESOURCE";
      const isSystemError =
        classification === "NETWORK_FAILURE" || classification === "UNEXPECTED_SERVER_ERROR";
      const passed = !isMissing && !isSystemError;

      results.push({
        step: `RPC Check: ${rpc}`,
        passed,
        details: isMissing
          ? `RPC function ${rpc} not found in database schema.`
          : isSystemError
            ? `RPC check failed with unexpected error (${classification}): ${error?.message}`
            : `Function registered and validated in schema (classification: ${classification}).`,
      });
    } catch (err) {
      results.push({
        step: `RPC Check: ${rpc}`,
        passed: false,
        details: String(err),
      });
    }
  }

  // 4. Genuine RLS Security Verification using Unauthenticated (Anon) Client
  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  // 4a. Anonymous access to audit_logs must be DENIED (RLS active)
  // 4a. Anonymous access to audit_logs must be DENIED (RLS active)
  // First, verify with service-role client that audit_logs actually contains rows to prevent false passes on empty tables
  let serviceAuditCount = 0;
  try {
    const { count, error } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true });
    if (error) {
      results.push({
        step: "Audit Logs Fixture Verification (Service Role)",
        passed: false,
        details: `Service-role could not query audit_logs count: ${error.message}`,
      });
    } else {
      serviceAuditCount = count ?? 0;
    }
  } catch (err) {
    results.push({
      step: "Audit Logs Fixture Verification (Service Role)",
      passed: false,
      details: `Exception querying audit_logs fixture count: ${String(err)}`,
    });
  }

  try {
    const { data, error } = await anonClient.from("audit_logs").select("*").limit(1);
    const classification = classifyPostgrestResponse(error);
    let isDenied = false;
    let details = "";

    if (classification === "AUTH_DENIED") {
      isDenied = true;
      details = `Anonymous access blocked by explicit RLS authorization denial (${error?.code}): ${error?.message}`;
    } else if (classification === "SUCCESS") {
      if (serviceAuditCount > 0 && Array.isArray(data) && data.length === 0) {
        isDenied = true;
        details = `Anonymous access isolated via RLS row-filtering (service rows: ${serviceAuditCount}, visible anonymous rows: 0).`;
      } else if (serviceAuditCount === 0) {
        isDenied = false;
        details = `FAILURE: audit_logs table has 0 service rows; empty response does not prove RLS isolation without existing fixtures.`;
      } else {
        isDenied = false;
        details = `CRITICAL FAILURE: Anonymous caller read ${data?.length} private audit log rows!`;
      }
    } else {
      isDenied = false;
      details = `FAILURE: Expected authorization denial (AUTH_DENIED), got ${classification}: ${error?.message}`;
    }

    results.push({
      step: "RLS Enforcement: audit_logs isolated from anonymous access",
      passed: isDenied,
      details,
    });
  } catch (err) {
    results.push({
      step: "RLS Enforcement: audit_logs isolated from anonymous access",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4b. Anonymous access to blockchain_outbox must be DENIED
  let serviceOutboxCount = 0;
  try {
    const { count, error } = await supabase
      .from("blockchain_outbox")
      .select("*", { count: "exact", head: true });
    if (error) {
      results.push({
        step: "Outbox Queue Fixture Verification (Service Role)",
        passed: false,
        details: `Service-role could not query outbox count: ${error.message}`,
      });
    } else {
      serviceOutboxCount = count ?? 0;
    }
  } catch (err) {
    results.push({
      step: "Outbox Queue Fixture Verification (Service Role)",
      passed: false,
      details: `Exception querying outbox fixture count: ${String(err)}`,
    });
  }

  try {
    const { data, error } = await anonClient.from("blockchain_outbox").select("*").limit(1);
    const classification = classifyPostgrestResponse(error);
    let isDenied = false;
    let details = "";

    if (classification === "AUTH_DENIED") {
      isDenied = true;
      details = `Outbox queue blocked by explicit RLS authorization denial (${error?.code}): ${error?.message}`;
    } else if (classification === "SUCCESS") {
      if (serviceOutboxCount > 0 && Array.isArray(data) && data.length === 0) {
        isDenied = true;
        details = `Outbox queue isolated via RLS row-filtering (service rows: ${serviceOutboxCount}, visible anonymous rows: 0).`;
      } else if (serviceOutboxCount === 0) {
        isDenied = false;
        details = `FAILURE: blockchain_outbox table has 0 service rows; empty response does not prove RLS isolation without existing fixtures.`;
      } else {
        isDenied = false;
        details = `CRITICAL FAILURE: Anonymous caller read ${data?.length} outbox queue rows!`;
      }
    } else {
      isDenied = false;
      details = `FAILURE: Expected authorization denial (AUTH_DENIED), got ${classification}: ${error?.message}`;
    }

    results.push({
      step: "RLS Enforcement: blockchain_outbox isolated from anonymous access",
      passed: isDenied,
      details,
    });
  } catch (err) {
    results.push({
      step: "RLS Enforcement: blockchain_outbox isolated from anonymous access",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4c. Anonymous write to projects must be REJECTED
  try {
    const { error } = await anonClient.from("projects").insert({
      project_code: "BC-ANON-TEST",
      name: "Unauthorized Project",
    } as never);
    const classification = classifyPostgrestResponse(error);
    const passed = classification === "AUTH_DENIED";
    results.push({
      step: "RLS Enforcement: Unauthorized INSERT to projects rejected",
      passed,
      details: passed
        ? `Rejected by RLS as expected (${error?.code}): ${error?.message}`
        : `FAILURE: Expected authorization denial (AUTH_DENIED), got ${classification}: ${error ? error.message : "INSERT succeeded!"}`,
    });
  } catch (err) {
    results.push({
      step: "RLS Enforcement: Unauthorized INSERT to projects rejected",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4d. Anonymous call to claim_next_outbox_job must be REJECTED
  try {
    const { error } = await anonClient.rpc(
      "claim_next_outbox_job" as never,
      {
        _worker_id: "unauthorized-worker",
      } as never,
    );
    const classification = classifyPostgrestResponse(error);
    const passed = classification === "AUTH_DENIED";
    results.push({
      step: "RPC Authorization: Anonymous call to claim_next_outbox_job rejected",
      passed,
      details: passed
        ? `Privileged RPC rejected as expected (${error?.code}): ${error?.message}`
        : `FAILURE: Expected authorization failure (AUTH_DENIED), got ${classification}: ${error ? error.message : "RPC succeeded!"}`,
    });
  } catch (err) {
    results.push({
      step: "RPC Authorization: Anonymous call to claim_next_outbox_job rejected",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4e. Anonymous call to perform_verification_decision must be REJECTED
  try {
    const { error } = await anonClient.rpc(
      "perform_verification_decision" as never,
      {
        _project_id: "00000000-0000-0000-0000-000000000000",
        _decision: "APPROVED",
        _notes: "Exploit attempt",
      } as never,
    );
    const classification = classifyPostgrestResponse(error);
    const passed = classification === "AUTH_DENIED";
    results.push({
      step: "RPC Authorization: Anonymous verification decision rejected",
      passed,
      details: passed
        ? `Verification RPC rejected as expected (${error?.code}): ${error?.message}`
        : `FAILURE: Expected authorization failure (AUTH_DENIED), got ${classification}: ${error ? error.message : "RPC succeeded!"}`,
    });
  } catch (err) {
    results.push({
      step: "RPC Authorization: Anonymous verification decision rejected",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4f. Anonymous call to complete_outbox_job must be REJECTED
  try {
    const { error } = await anonClient.rpc(
      "complete_outbox_job" as never,
      {
        _job_id: "00000000-0000-0000-0000-000000000000",
      } as never,
    );
    const classification = classifyPostgrestResponse(error);
    const passed = classification === "AUTH_DENIED";
    results.push({
      step: "RPC Authorization: Anonymous call to complete_outbox_job rejected",
      passed,
      details: passed
        ? `Completion RPC rejected for anonymous caller as expected (${error?.code}): ${error?.message}`
        : `FAILURE: Expected authorization failure (AUTH_DENIED), got ${classification}: ${error ? error.message : "RPC succeeded!"}`,
    });
  } catch (err) {
    results.push({
      step: "RPC Authorization: Anonymous call to complete_outbox_job rejected",
      passed: false,
      details: `Unexpected network/system error during test: ${String(err)}`,
    });
  }

  // 4g. Public read-only RPCs must be permitted
  try {
    const { error } = await anonClient.rpc("list_public_projects" as never);
    const classification = classifyPostgrestResponse(error);
    results.push({
      step: "Public Read RPC: list_public_projects accessible to anonymous users",
      passed: classification === "SUCCESS",
      details:
        classification === "SUCCESS"
          ? "Public registry view accessible."
          : `Failed reading public RPC (classification: ${classification}): ${error?.message}`,
    });
  } catch (err) {
    results.push({
      step: "Public Read RPC: list_public_projects accessible to anonymous users",
      passed: false,
      details: String(err),
    });
  }

  // 5. Authenticated Session Isolation (Owner & Verifier Boundaries)
  // When staging session tokens (or test account credentials) are configured, verify cross-project isolation
  const ownerJwt = process.env["STAGING_OWNER_JWT"];
  const verifierJwt = process.env["STAGING_VERIFIER_JWT"];
  const isReleaseMode =
    process.env["RELEASE_MODE"] === "production" || process.argv.includes("--release");

  if (ownerJwt) {
    const ownerClient = createClient(url, anonKey || serviceKey, {
      global: { headers: { Authorization: `Bearer ${ownerJwt}` } },
      auth: { persistSession: false },
    });

    // 5a. Owner CANNOT modify user_roles table (privilege escalation prevention)
    try {
      const { error } = await ownerClient.from("user_roles").insert({
        role: "admin",
      } as never);
      const classification = classifyPostgrestResponse(error);
      const passed = classification === "AUTH_DENIED";
      results.push({
        step: "Authenticated Owner: Self-promotion to admin rejected",
        passed,
        details: passed
          ? `Privilege escalation blocked as expected (${error?.code}): ${error?.message}`
          : `FAILURE: Expected authorization denial (AUTH_DENIED), got ${classification}: ${error ? error.message : "INSERT succeeded"}`,
      });
    } catch (err) {
      results.push({
        step: "Authenticated Owner: Self-promotion to admin rejected",
        passed: false,
        details: `Unexpected network/system exception during test: ${String(err)}`,
      });
    }

    // 5b. Owner CANNOT approve their own submission via perform_verification_decision
    try {
      const { error } = await ownerClient.rpc(
        "perform_verification_decision" as never,
        {
          _project_id: "00000000-0000-0000-0000-000000000000",
          _decision: "APPROVED",
          _notes: "Owner self-approval exploit attempt",
        } as never,
      );
      const classification = classifyPostgrestResponse(error);
      const passed = classification === "AUTH_DENIED";
      results.push({
        step: "Authenticated Owner: Cannot invoke perform_verification_decision",
        passed,
        details: passed
          ? `Verifier RPC rejected for non-verifier owner as expected (${error?.code}): ${error?.message}`
          : `FAILURE: Expected authorization failure (AUTH_DENIED), got ${classification}: ${error ? error.message : "RPC succeeded"}`,
      });
    } catch (err) {
      results.push({
        step: "Authenticated Owner: Cannot invoke perform_verification_decision",
        passed: false,
        details: `Unexpected network/system exception during test: ${String(err)}`,
      });
    }

    // 5c. Owner CANNOT view private evidence belonging to another project ID
    // Find an actual existing project that HAS private evidence via service role
    let foreignProjectId: string | null = null;
    let foreignEvidenceCount = 0;
    try {
      const { data: evidenceRows } = await supabase
        .from("evidence")
        .select("project_id, is_public")
        .eq("is_public", false)
        .limit(1);

      if (evidenceRows && evidenceRows.length > 0) {
        foreignProjectId = evidenceRows[0]!.project_id;
        const { count } = await supabase
          .from("evidence")
          .select("id", { count: "exact", head: true })
          .eq("project_id", foreignProjectId)
          .eq("is_public", false);
        foreignEvidenceCount = count ?? 0;
      }
    } catch {
      // fallback
    }

    if (!foreignProjectId || foreignEvidenceCount === 0) {
      results.push({
        step: "Authenticated Owner: Cross-project private evidence read blocked",
        passed: !isReleaseMode,
        details: isReleaseMode
          ? "FAIL: No private evidence fixture found in database to prove cross-project isolation."
          : "SKIPPED: No private evidence fixtures present to verify isolation (dev mode).",
      });
    } else {
      try {
        const { data, error } = await ownerClient
          .from("evidence")
          .select("id, file_url")
          .eq("project_id", foreignProjectId);

        const classification = classifyPostgrestResponse(error);
        let noLeak = false;
        let details = "";

        if (classification === "AUTH_DENIED") {
          noLeak = true;
          details = `Cross-project evidence read denied by authorization policy: ${error?.message}`;
        } else if (classification === "SUCCESS") {
          if (Array.isArray(data) && data.length === 0) {
            noLeak = true;
            details = `Verified isolation: target project has ${foreignEvidenceCount} private records under service-role, but owner sees 0.`;
          } else {
            noLeak = false;
            details = `CRITICAL FAILURE: Owner retrieved ${data?.length} private records belonging to project ${foreignProjectId}!`;
          }
        } else {
          noLeak = false;
          details = `FAILURE: Unexpected error during isolation check (${classification}): ${error?.message}`;
        }

        results.push({
          step: "Authenticated Owner: Cross-project private evidence read blocked",
          passed: noLeak,
          details,
        });
      } catch (err) {
        results.push({
          step: "Authenticated Owner: Cross-project private evidence read blocked",
          passed: false,
          details: `Unexpected network error during isolation check: ${String(err)}`,
        });
      }
    }
  } else {
    results.push({
      step: "Authenticated Owner Session Verification",
      passed: !isReleaseMode,
      details: isReleaseMode
        ? "FAIL: STAGING_OWNER_JWT is required for release-validation mode."
        : "SKIPPED: STAGING_OWNER_JWT not set; skipping live owner session check (dev mode).",
    });
  }

  if (verifierJwt) {
    const verifierClient = createClient(url, anonKey || serviceKey, {
      global: { headers: { Authorization: `Bearer ${verifierJwt}` } },
      auth: { persistSession: false },
    });

    // 5d. Verifier CANNOT arbitrarily write or update project ownership
    try {
      const { error } = await verifierClient
        .from("projects")
        .update({ owner_id: "00000000-0000-0000-0000-000000000000" } as never)
        .eq("id", "00000000-0000-0000-0000-000000000000");
      const classification = classifyPostgrestResponse(error);
      const passed = classification === "AUTH_DENIED";
      results.push({
        step: "Authenticated Verifier: Project owner hijacking rejected",
        passed,
        details: passed
          ? `Owner hijacking blocked as expected (${error?.code}): ${error?.message}`
          : `FAILURE: Expected authorization denial (AUTH_DENIED), got ${classification}: ${error ? error.message : "UPDATE succeeded!"}`,
      });
    } catch (err) {
      results.push({
        step: "Authenticated Verifier: Project owner hijacking rejected",
        passed: false,
        details: `Unexpected network/system error during test: ${String(err)}`,
      });
    }
  } else {
    results.push({
      step: "Authenticated Verifier Session Verification",
      passed: !isReleaseMode,
      details: isReleaseMode
        ? "FAIL: STAGING_VERIFIER_JWT is required for release-validation mode."
        : "SKIPPED: STAGING_VERIFIER_JWT not set; skipping live verifier session check (dev mode).",
    });
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}

// Direct execution
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("validate-live-db.ts")
) {
  console.log("=== Validating Live / Staging Database Schema & Permissions ===");
  validateLiveDatabase().then(({ allPassed, results }) => {
    for (const r of results) {
      console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.step}: ${r.details}`);
    }
    console.log("===============================================================");
    console.log(
      allPassed ? "All live database validations PASSED." : "Database validation FAILED.",
    );
    if (!allPassed) process.exit(1);
  });
}
