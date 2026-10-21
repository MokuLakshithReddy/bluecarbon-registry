/**
 * Administrative Demo Account Provisioning Script
 *
 * Audit Reference: Finding 1 (Security Containment)
 *
 * This script is strictly for administrative or development environments.
 * It is NEVER exposed to public HTTP endpoints.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=true ADMIN_SEED_SECRET=your-secret node --loader ts-node/esm scripts/seed-demo-accounts.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOW_DEMO_SEED = process.env.ALLOW_DEMO_SEED === "true";
const ADMIN_SEED_SECRET = process.env.ADMIN_SEED_SECRET;

if (!ALLOW_DEMO_SEED) {
  console.error("REFUSED: Demo account seeding is disabled. Set ALLOW_DEMO_SEED=true to run in non-production.");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_ACCOUNTS = [
  {
    email: "owner@bluecarbon.demo",
    password: process.env.DEMO_OWNER_PASSWORD || "bluecarbon123",
    role: "project_owner" as const,
    full_name: "Demo Project Owner",
    organization: "Coastal Green Foundation",
    phone: "+91 90000 00001",
  },
  {
    email: "verifier@nccr.demo",
    password: process.env.DEMO_VERIFIER_PASSWORD || "bluecarbon123",
    role: "verifier" as const,
    full_name: "NCCR Verifier",
    organization: "National Centre for Coastal Research",
    phone: "+91 90000 00002",
  },
];

async function seed() {
  console.log("Seeding demo accounts safely via administrative script...");

  for (const acc of DEMO_ACCOUNTS) {
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", acc.email)
      .maybeSingle();

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

    if (userId) {
      // Assign role explicitly through service role
      const { error: roleError } = await adminClient.from("user_roles").upsert(
        { user_id: userId, role: acc.role },
        { onConflict: "user_id,role" },
      );
      if (roleError) {
        console.warn(`Could not set role for ${acc.email}:`, roleError.message);
      }

      if (acc.role === "project_owner") {
        await adminClient.from("projects").update({ owner_id: userId }).eq("owner_email", acc.email);
      }
      console.log(`Successfully configured account: ${acc.email} (${acc.role})`);
    }
  }

  console.log("Demo account seeding completed.");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
