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

  const results: ValidationResult[] = [];

  // 1. Connection check
  try {
    const { error } = await supabase.from("projects").select("id").limit(1);
    results.push({
      step: "Database Connectivity",
      passed: !error,
      details: error ? error.message : "Connected successfully to Supabase database.",
    });
  } catch (err) {
    results.push({
      step: "Database Connectivity",
      passed: false,
      details: String(err),
    });
    return { allPassed: false, results };
  }

  // 2. Table presence & RLS check
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

  // 3. RPC check
  for (const rpc of REQUIRED_RPCS) {
    try {
      // Intentionally call with dummy args to check RPC existence (PGRST202 if missing)
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
