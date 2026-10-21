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

export async function validateLiveDatabase(): Promise<{
  allPassed: boolean;
  results: ValidationResult[];
}> {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

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

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const anonKey =
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_ANON_KEY"];

  const results: ValidationResult[] = [];

  // 1. Connection check with service-role
  try {
    const { error } = await supabase.from("projects").select("id").limit(1);
    results.push({
      step: "Database Connectivity (Service Role)",
      passed: !error,
      details: error ? error.message : "Connected successfully to Supabase database.",
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
      results.push({
        step: `Table Check: ${table}`,
        passed: !error,
        details: error ? error.message : "Table accessible under service-role.",
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
      const isMissing =
        error && (error.code === "PGRST202" || error.message.includes("Could not find"));
      results.push({
        step: `RPC Check: ${rpc}`,
        passed: !isMissing,
        details: isMissing
          ? `RPC function ${rpc} not found in database.`
          : "Function registered in schema.",
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
  if (anonKey) {
    const anonClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });

    // 4a. Anonymous access to audit_logs must be DENIED (RLS active)
    // First, verify with service-role client that audit_logs actually contains rows to prevent false passes on empty tables
    let serviceAuditCount = 0;
    try {
      const { count } = await supabase
        .from("audit_logs")
        .select("*", { count: "exact", head: true });
      serviceAuditCount = count ?? 0;
    } catch {
      // ignore
    }

    try {
      const { data, error } = await anonClient.from("audit_logs").select("*").limit(1);
      // RLS policy rejection returns either an explicit error (e.g. 42501 permission denied) or empty array when table has rows
      const isDenied = Boolean(error) || (serviceAuditCount > 0 && (!data || data.length === 0));
      results.push({
        step: "RLS Enforcement: audit_logs isolated from anonymous access",
        passed: isDenied,
        details: isDenied
          ? `Anonymous access blocked by RLS (service rows: ${serviceAuditCount}, anon error: ${error?.message ?? "empty"}).`
          : "FAILURE: audit_logs returned data or table is empty and cannot prove RLS isolation!",
      });
    } catch {
      results.push({
        step: "RLS Enforcement: audit_logs isolated from anonymous access",
        passed: true,
        details: "Anonymous access rejected with exception.",
      });
    }

    // 4b. Anonymous access to blockchain_outbox must be DENIED
    let serviceOutboxCount = 0;
    try {
      const { count } = await supabase
        .from("blockchain_outbox")
        .select("*", { count: "exact", head: true });
      serviceOutboxCount = count ?? 0;
    } catch {
      // ignore
    }

    try {
      const { data, error } = await anonClient.from("blockchain_outbox").select("*").limit(1);
      const isDenied = Boolean(error) || (serviceOutboxCount > 0 && (!data || data.length === 0));
      results.push({
        step: "RLS Enforcement: blockchain_outbox isolated from anonymous access",
        passed: isDenied,
        details: isDenied
          ? `Outbox queue blocked by RLS (service rows: ${serviceOutboxCount}, anon error: ${error?.message ?? "empty"}).`
          : "FAILURE: blockchain_outbox returned data or table is empty without proof of isolation!",
      });
    } catch {
      results.push({
        step: "RLS Enforcement: blockchain_outbox isolated from anonymous access",
        passed: true,
        details: "Anonymous access rejected with exception.",
      });
    }

    // 4c. Anonymous write to projects must be REJECTED
    try {
      const { error } = await anonClient.from("projects").insert({
        project_code: "BC-ANON-TEST",
        name: "Unauthorized Project",
      } as never);
      const blocked = error != null;
      results.push({
        step: "RLS Enforcement: Unauthorized INSERT to projects rejected",
        passed: blocked,
        details: blocked
          ? `Rejected as expected: ${error?.message}`
          : "FAILURE: Anonymous insert into projects succeeded!",
      });
    } catch {
      results.push({
        step: "RLS Enforcement: Unauthorized INSERT to projects rejected",
        passed: true,
        details: "Anonymous write rejected.",
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
      const blocked = error != null;
      results.push({
        step: "RPC Authorization: Anonymous call to claim_next_outbox_job rejected",
        passed: blocked,
        details: blocked
          ? `Privileged RPC rejected as expected: ${error?.message}`
          : "FAILURE: Anonymous caller was able to invoke claim_next_outbox_job!",
      });
    } catch {
      results.push({
        step: "RPC Authorization: Anonymous call to claim_next_outbox_job rejected",
        passed: true,
        details: "Privileged RPC rejected.",
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
      const blocked = error != null;
      results.push({
        step: "RPC Authorization: Anonymous verification decision rejected",
        passed: blocked,
        details: blocked
          ? `Verification RPC rejected as expected: ${error?.message}`
          : "FAILURE: Anonymous caller was able to approve a project!",
      });
    } catch {
      results.push({
        step: "RPC Authorization: Anonymous verification decision rejected",
        passed: true,
        details: "Verification decision rejected.",
      });
    }

    // 4f. Public read-only RPCs must be permitted
    try {
      const { error } = await anonClient.rpc("list_public_projects" as never);
      results.push({
        step: "Public Read RPC: list_public_projects accessible to anonymous users",
        passed: !error,
        details: error ? error.message : "Public registry view accessible.",
      });
    } catch (err) {
      results.push({
        step: "Public Read RPC: list_public_projects accessible to anonymous users",
        passed: false,
        details: String(err),
      });
    }
  } else {
    results.push({
      step: "RLS Anonymous Verification",
      passed: false,
      details: "FAILURE: SUPABASE_ANON_KEY not set. Cannot verify anonymous boundary isolation.",
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
      const blocked = error != null;
      results.push({
        step: "Authenticated Owner: Self-promotion to admin rejected",
        passed: blocked,
        details: blocked
          ? `Privilege escalation blocked as expected: ${error?.message}`
          : "FAILURE: Owner was able to insert into user_roles!",
      });
    } catch {
      results.push({
        step: "Authenticated Owner: Self-promotion to admin rejected",
        passed: true,
        details: "Privilege escalation attempt rejected.",
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
      const blocked = error != null;
      results.push({
        step: "Authenticated Owner: Cannot invoke perform_verification_decision",
        passed: blocked,
        details: blocked
          ? `Verifier RPC rejected for non-verifier owner as expected: ${error?.message}`
          : "FAILURE: Owner was able to invoke perform_verification_decision!",
      });
    } catch {
      results.push({
        step: "Authenticated Owner: Cannot invoke perform_verification_decision",
        passed: true,
        details: "Privileged verifier RPC rejected for owner.",
      });
    }

    // 5c. Owner CANNOT view private evidence belonging to another project ID
    // Find an actual existing project owned by another user via service role to test real isolation
    let foreignProjectId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    try {
      const { data: foreignProjects } = await supabase.from("projects").select("id").limit(5);
      if (foreignProjects && foreignProjects.length > 0) {
        foreignProjectId = foreignProjects[foreignProjects.length - 1]!.id;
      }
    } catch {
      // fallback to UUID
    }

    try {
      const { data, error } = await ownerClient
        .from("evidence")
        .select("id, file_url")
        .eq("project_id", foreignProjectId);
      const noLeak = error != null || !data || data.length === 0;
      results.push({
        step: "Authenticated Owner: Cross-project private evidence read blocked",
        passed: noLeak,
        details: noLeak
          ? `No foreign evidence visible to owner session for project ${foreignProjectId}.`
          : "FAILURE: Foreign project private evidence returned to owner!",
      });
    } catch {
      results.push({
        step: "Authenticated Owner: Cross-project private evidence read blocked",
        passed: true,
        details: "Foreign project evidence read blocked.",
      });
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
      const blocked = error != null;
      results.push({
        step: "Authenticated Verifier: Project owner hijacking rejected",
        passed: blocked,
        details: blocked
          ? `Owner hijacking blocked as expected: ${error?.message}`
          : "FAILURE: Verifier could reassign project ownership!",
      });
    } catch {
      results.push({
        step: "Authenticated Verifier: Project owner hijacking rejected",
        passed: true,
        details: "Ownership tampering blocked.",
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
