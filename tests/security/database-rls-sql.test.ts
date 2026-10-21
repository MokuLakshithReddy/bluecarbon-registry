import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../supabase/migrations/20261021000000_fix_privilege_escalation_and_harden_rls.sql",
);

test("Database Boundary: migration file exists and is readable", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Hardened migration file must exist");
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  assert.ok(sql.length > 1000);
});

test("Database Boundary: handle_new_user() prevents privilege escalation at DB trigger level", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  // Verify function definition
  assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.handle_new_user()"));
  assert.ok(sql.includes("SECURITY DEFINER"));

  // Verify that any role passed in raw_user_meta_data is strictly ignored
  // and default role is hardcoded to 'project_owner'
  assert.ok(
    sql.includes("VALUES (NEW.id, 'project_owner'::public.app_role)"),
    "Default role in database trigger must be hardcoded to 'project_owner'",
  );
  assert.strictEqual(
    sql.includes("NEW.raw_user_meta_data->>'role'"),
    false,
    "Database trigger must never read role from raw_user_meta_data",
  );
});

test("Database Boundary: user_roles RLS policies permit role assignment exclusively to admins", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  assert.ok(sql.includes('CREATE POLICY "admin assign roles" ON public.user_roles'));
  assert.ok(sql.includes("WITH CHECK (public.has_role(auth.uid(), 'admin'))"));

  assert.ok(sql.includes('CREATE POLICY "admin update roles" ON public.user_roles'));
  assert.ok(sql.includes("USING (public.has_role(auth.uid(), 'admin'))"));

  assert.ok(sql.includes('CREATE POLICY "admin delete roles" ON public.user_roles'));
  assert.ok(sql.includes("USING (public.has_role(auth.uid(), 'admin'))"));
});

test("Database Boundary: perform_verification_decision procedure enforces concurrency locking and authorization", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.perform_verification_decision"),
    "Stored procedure must exist",
  );
  assert.ok(sql.includes("FOR UPDATE"), "Must acquire row-level lock on projects table");
  assert.ok(
    sql.includes("v_project.status IS DISTINCT FROM _expected_status"),
    "Must verify expected status to prevent concurrency race conditions",
  );
  assert.ok(
    sql.includes("public.has_role(_verifier_id, 'verifier')"),
    "Must verify verifier role authorization",
  );
  assert.ok(
    sql.includes("v_project.status != 'UNDER_REVIEW'"),
    "Must require UNDER_REVIEW state before approving",
  );
  assert.ok(
    sql.includes("_confirmed_carbon IS NULL OR _confirmed_carbon <= 0"),
    "Must validate positive confirmed carbon value",
  );
});

test("Database Boundary: owners update policy forbids altering verified projects", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  assert.ok(
    sql.includes('CREATE POLICY "owners update own projects" ON public.projects'),
    "Must define hardened owners update policy",
  );
  assert.ok(
    sql.includes("status IN ('DRAFT', 'CORRECTION_REQUIRED')"),
    "Owners must only be allowed to update projects in DRAFT or CORRECTION_REQUIRED status",
  );
});

test("Database Boundary: verification and carbon impact records are strictly immutable (no update / no delete)", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  assert.ok(
    sql.includes(
      'CREATE POLICY "review no update" ON public.verification_reviews FOR UPDATE TO authenticated USING (false)',
    ),
    "verification_reviews updates must be disallowed",
  );
  assert.ok(
    sql.includes(
      'CREATE POLICY "review no delete" ON public.verification_reviews FOR DELETE TO authenticated USING (false)',
    ),
    "verification_reviews deletes must be disallowed",
  );
  assert.ok(
    sql.includes(
      'CREATE POLICY "carbon impact no update" ON public.carbon_impact_records FOR UPDATE TO authenticated USING (false)',
    ),
    "carbon_impact_records updates must be disallowed",
  );
  assert.ok(
    sql.includes(
      'CREATE POLICY "carbon impact no delete" ON public.carbon_impact_records FOR DELETE TO authenticated USING (false)',
    ),
    "carbon_impact_records deletes must be disallowed",
  );
});

test("Database Boundary: SECURITY DEFINER functions use robust is_service_role() instead of current_user = 'service_role'", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

  // Must declare is_service_role helper
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.is_service_role()"),
    "Must define is_service_role() helper function",
  );
  assert.ok(
    sql.includes("session_user = 'service_role'"),
    "is_service_role must inspect session_user",
  );
  assert.ok(
    sql.includes("request.jwt.claim.role"),
    "is_service_role must inspect request.jwt.claim.role",
  );

  // Must NOT use buggy current_user = 'service_role' inside SECURITY DEFINER functions
  assert.strictEqual(
    sql.includes("current_user = 'service_role'"),
    false,
    "Must not check current_user = 'service_role' inside SECURITY DEFINER functions",
  );
  assert.strictEqual(
    sql.includes("current_user != 'service_role'"),
    false,
    "Must not check current_user != 'service_role' inside SECURITY DEFINER functions",
  );
});
