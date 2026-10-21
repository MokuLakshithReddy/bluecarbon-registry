/**
 * Administrative Demo Account Provisioning Script
 *
 * Audit Reference: Finding 4 (Demo account provisioning hardening)
 *
 * Safeguards implemented:
 * 1. Explicitly rejects production environments (NODE_ENV, APP_ENV, VERCEL_ENV).
 * 2. Mandatory ADMIN_SEED_SECRET validation (minimum 16 characters).
 * 3. Removes all hardcoded password fallbacks (demands strong passwords via env).
 * 4. Fails closed if role assignment fails rather than silently logging.
 * 5. Strictly prevents provisioning verifier privileges without explicit development safeguards.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=true \
 *   ADMIN_SEED_SECRET=your-minimum-16-char-secret \
 *   DEMO_OWNER_PASSWORD=your-secure-owner-password \
 *   DEMO_VERIFIER_PASSWORD=your-secure-verifier-password \
 *   bun run scripts/seed-demo-accounts.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";

const NODE_ENV = (process.env["NODE_ENV"] || "").toLowerCase();
const APP_ENV = (process.env["APP_ENV"] || "").toLowerCase();
const VERCEL_ENV = (process.env["VERCEL_ENV"] || "").toLowerCase();

// Safeguard 1: Explicitly reject production environments
if (NODE_ENV === "production" || APP_ENV === "production" || VERCEL_ENV === "production") {
  console.error(
    "FATAL: Demo account seeding is strictly forbidden in production environments (NODE_ENV/APP_ENV/VERCEL_ENV=production).",
  );
  process.exit(1);
}

const ALLOW_DEMO_SEED = process.env["ALLOW_DEMO_SEED"] === "true";
if (!ALLOW_DEMO_SEED) {
  console.error(
    "REFUSED: Demo account seeding is disabled. Set ALLOW_DEMO_SEED=true to run in local/development environment.",
  );
  process.exit(1);
}

// Safeguard 2: Require and validate ADMIN_SEED_SECRET
const ADMIN_SEED_SECRET = process.env["ADMIN_SEED_SECRET"];
if (!ADMIN_SEED_SECRET || ADMIN_SEED_SECRET.trim().length < 16) {
  console.error(
    "FATAL: ADMIN_SEED_SECRET must be provided and must be at least 16 characters in length.",
  );
  process.exit(1);
}

const EXPECTED_ADMIN_SEED_SECRET = process.env["EXPECTED_ADMIN_SEED_SECRET"];
if (EXPECTED_ADMIN_SEED_SECRET && ADMIN_SEED_SECRET !== EXPECTED_ADMIN_SEED_SECRET) {
  console.error("FATAL: ADMIN_SEED_SECRET does not match EXPECTED_ADMIN_SEED_SECRET.");
  process.exit(1);
}

// Safeguard 3: Require explicit, secure passwords without fallbacks
const DEMO_OWNER_PASSWORD = process.env["DEMO_OWNER_PASSWORD"];
const DEMO_VERIFIER_PASSWORD = process.env["DEMO_VERIFIER_PASSWORD"];

if (!DEMO_OWNER_PASSWORD || DEMO_OWNER_PASSWORD.length < 12) {
  console.error(
    "FATAL: DEMO_OWNER_PASSWORD must be provided via environment variables and be at least 12 characters long.",
  );
  process.exit(1);
}

if (!DEMO_VERIFIER_PASSWORD || DEMO_VERIFIER_PASSWORD.length < 12) {
  console.error(
    "FATAL: DEMO_VERIFIER_PASSWORD must be provided via environment variables and be at least 12 characters long.",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: Missing required SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_ACCOUNTS = [
  {
    email: "owner@bluecarbon.demo",
    password: DEMO_OWNER_PASSWORD,
    role: "project_owner" as const,
    full_name: "Demo Project Owner",
    organization: "Coastal Green Foundation",
    phone: "+91 90000 00001",
  },
  {
    email: "verifier@nccr.demo",
    password: DEMO_VERIFIER_PASSWORD,
    role: "verifier" as const,
    full_name: "NCCR Verifier",
    organization: "National Centre for Coastal Research",
    phone: "+91 90000 00002",
  },
];

async function seed() {
  console.log("Seeding demo accounts safely via administrative script (non-production)...");

  for (const acc of DEMO_ACCOUNTS) {
    // Safeguard 4: Guard verifier privilege assignment
    if (acc.role === "verifier" && (NODE_ENV === "production" || APP_ENV === "production")) {
      throw new Error("SECURITY VIOLATION: Verifier roles cannot be seeded in production.");
    }

    const { data: existingProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", acc.email)
      .maybeSingle();

    if (profileErr) {
      throw new Error(`Failed to query existing profile for ${acc.email}: ${profileErr.message}`);
    }

    let userId = existingProfile?.id;

    if (!userId) {
      console.log(`Creating user: ${acc.email}...`);
      const { data, error } = await adminClient.auth.admin.createUser({
        email: acc.email,
        password: acc.password,
        email_confirm: true,
        user_metadata: {
          full_name: acc.full_name,
          organization: acc.organization,
          phone: acc.phone,
        },
      });

      if (error && !/already/i.test(error.message)) {
        throw new Error(`Failed to create ${acc.email}: ${error.message}`);
      }
      userId = data?.user?.id;
    }

    if (!userId) {
      throw new Error(`Failed to obtain userId for account: ${acc.email}`);
    }

    // Assign role explicitly through service role - fail closed on error
    const { error: roleError } = await adminClient
      .from("user_roles")
      .upsert({ user_id: userId, role: acc.role }, { onConflict: "user_id,role" });

    if (roleError) {
      throw new Error(
        `FATAL: Role assignment failed for ${acc.email} (${acc.role}): ${roleError.message}`,
      );
    }

    if (acc.role === "project_owner") {
      const { error: updateErr } = await adminClient
        .from("projects")
        .update({ owner_id: userId })
        .eq("owner_email", acc.email);

      if (updateErr) {
        throw new Error(`Failed linking projects for ${acc.email}: ${updateErr.message}`);
      }
    }

    console.log(`Successfully configured account: ${acc.email} (${acc.role})`);
  }

  console.log("Demo account seeding completed successfully with all security checks passing.");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
