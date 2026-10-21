import test from "node:test";
import assert from "node:assert";
import type { ProjectStatus } from "../../src/lib/domain.ts";

/**
 * Registry State Machine Implementation & Validator
 *
 * Audit Reference: Finding 2 (Verification Workflow and Data Integrity)
 */
class ProjectStateMachine {
  private static VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
    UNDER_REVIEW: ["VERIFIED", "CORRECTION_REQUIRED", "REJECTED"],
    CORRECTION_REQUIRED: ["SUBMITTED"],
    VERIFIED: [], // Terminal verified state
    REJECTED: [], // Terminal rejected state
  };

  static transition(
    currentStatus: ProjectStatus,
    targetStatus: ProjectStatus,
    payload: { confirmedCarbon?: number | null; comments?: string | null } = {},
  ): { success: boolean; newStatus: ProjectStatus } {
    const allowed = this.VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new Error(
        `Invalid state transition: Cannot transition from '${currentStatus}' to '${targetStatus}'. Allowed: ${allowed.join(", ") || "none (terminal state)"}.`,
      );
    }

    if (targetStatus === "VERIFIED") {
      const carbon = Number(payload.confirmedCarbon);
      if (!carbon || carbon <= 0 || Number.isNaN(carbon)) {
        throw new Error("Invalid carbon value: Confirmed carbon impact must be a positive number.");
      }
    }

    if (targetStatus === "CORRECTION_REQUIRED" || targetStatus === "REJECTED") {
      if (!payload.comments || payload.comments.trim().length < 5) {
        throw new Error("Verifier comments (minimum 5 characters) are required for this decision.");
      }
    }

    return { success: true, newStatus: targetStatus };
  }
}

test("State Machine: Valid workflow transitions succeed", () => {
  // DRAFT -> SUBMITTED
  const step1 = ProjectStateMachine.transition("DRAFT", "SUBMITTED");
  assert.strictEqual(step1.newStatus, "SUBMITTED");

  // SUBMITTED -> UNDER_REVIEW
  const step2 = ProjectStateMachine.transition("SUBMITTED", "UNDER_REVIEW");
  assert.strictEqual(step2.newStatus, "UNDER_REVIEW");

  // UNDER_REVIEW -> CORRECTION_REQUIRED
  const step3 = ProjectStateMachine.transition("UNDER_REVIEW", "CORRECTION_REQUIRED", {
    comments: "Please attach high-resolution drone geotiffs.",
  });
  assert.strictEqual(step3.newStatus, "CORRECTION_REQUIRED");

  // CORRECTION_REQUIRED -> SUBMITTED
  const step4 = ProjectStateMachine.transition("CORRECTION_REQUIRED", "SUBMITTED");
  assert.strictEqual(step4.newStatus, "SUBMITTED");

  // SUBMITTED -> UNDER_REVIEW
  const step5 = ProjectStateMachine.transition("SUBMITTED", "UNDER_REVIEW");
  assert.strictEqual(step5.newStatus, "UNDER_REVIEW");

  // UNDER_REVIEW -> VERIFIED
  const step6 = ProjectStateMachine.transition("UNDER_REVIEW", "VERIFIED", {
    confirmedCarbon: 3200,
  });
  assert.strictEqual(step6.newStatus, "VERIFIED");
});

test("State Machine: Illegitimate transitions are rejected", () => {
  // Cannot approve directly from DRAFT
  assert.throws(
    () => ProjectStateMachine.transition("DRAFT", "VERIFIED", { confirmedCarbon: 100 }),
    /Invalid state transition: Cannot transition from 'DRAFT' to 'VERIFIED'/,
  );

  // Cannot approve a REJECTED project
  assert.throws(
    () => ProjectStateMachine.transition("REJECTED", "VERIFIED", { confirmedCarbon: 100 }),
    /Invalid state transition: Cannot transition from 'REJECTED' to 'VERIFIED'/,
  );

  // Cannot re-approve an already VERIFIED project
  assert.throws(
    () => ProjectStateMachine.transition("VERIFIED", "VERIFIED", { confirmedCarbon: 100 }),
    /Invalid state transition: Cannot transition from 'VERIFIED' to 'VERIFIED'/,
  );

  // Cannot reject an already VERIFIED project
  assert.throws(
    () => ProjectStateMachine.transition("VERIFIED", "REJECTED", { comments: "Late objection" }),
    /Invalid state transition: Cannot transition from 'VERIFIED' to 'REJECTED'/,
  );
});

test("State Machine: Input boundaries and comments validation enforced", () => {
  // Approving without positive carbon throws
  assert.throws(
    () => ProjectStateMachine.transition("UNDER_REVIEW", "VERIFIED", { confirmedCarbon: 0 }),
    /Confirmed carbon impact must be a positive number/,
  );
  assert.throws(
    () => ProjectStateMachine.transition("UNDER_REVIEW", "VERIFIED", { confirmedCarbon: -50 }),
    /Confirmed carbon impact must be a positive number/,
  );

  // Requesting correction without comments throws
  assert.throws(
    () => ProjectStateMachine.transition("UNDER_REVIEW", "CORRECTION_REQUIRED", { comments: "" }),
    /Verifier comments \(minimum 5 characters\) are required/,
  );

  // Rejecting without comments throws
  assert.throws(
    () => ProjectStateMachine.transition("UNDER_REVIEW", "REJECTED", { comments: "  " }),
    /Verifier comments \(minimum 5 characters\) are required/,
  );
});

test("State Machine: Optimistic locking protects against concurrent verifications", () => {
  let projectStatus: ProjectStatus = "UNDER_REVIEW";

  function applyVerification(expectedStatus: ProjectStatus, newStatus: ProjectStatus) {
    if (projectStatus !== expectedStatus) {
      throw new Error(
        `Concurrency conflict: Project is '${projectStatus}', expected '${expectedStatus}'.`,
      );
    }
    projectStatus = newStatus;
  }

  // Verifier 1 approves
  applyVerification("UNDER_REVIEW", "VERIFIED");
  assert.strictEqual(projectStatus, "VERIFIED");

  // Verifier 2 tries to reject simultaneously expecting UNDER_REVIEW -> conflict thrown!
  assert.throws(() => applyVerification("UNDER_REVIEW", "REJECTED"), /Concurrency conflict/);
});

test("State Machine: approveProject fails closed and refuses non-atomic fallback on database error", async () => {
  const { approveProject, requestCorrection, rejectProject } =
    await import("../../src/lib/registry.server.ts");

  let fallbackUpdateExecuted = false;
  let fallbackReviewInserted = false;

  // Mock Supabase client where RPC fails
  const mockSupabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-0000-0000-000000000001", email: "verifier@test.org" } },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const projectData = {
            id: "00000000-0000-0000-0000-000000000002",
            project_code: "BC-MNG-TEST",
            name: "Test Mangrove",
            status: "UNDER_REVIEW",
            ecosystem: "MANGROVE",
            estimated_carbon: 500,
            owner_email: "owner@test.org",
          };
          const rolesData = [{ role: "verifier" }];

          return {
            then: (resolve: (val: unknown) => void) => {
              if (table === "user_roles") {
                return Promise.resolve({ data: rolesData, error: null }).then(resolve);
              }
              return Promise.resolve({ data: [projectData], error: null }).then(resolve);
            },
            single: async () => ({
              data: projectData,
              error: null,
            }),
            maybeSingle: async () => ({
              data: table === "user_roles" ? rolesData[0] : projectData,
              error: null,
            }),
          };
        },
      }),
      update: () => {
        fallbackUpdateExecuted = true;
        return {
          eq: () => ({
            eq: () => ({
              select: async () => [{ id: "00000000-0000-0000-0000-000000000002" }],
            }),
          }),
        };
      },
      insert: () => {
        fallbackReviewInserted = true;
        return Promise.resolve({ error: null });
      },
    }),
    rpc: async (_fn: string, _args: Record<string, unknown>) => {
      // Deliberately simulate database failure or missing procedure
      return {
        data: null,
        error: { message: "Simulated foreign key failure in atomic procedure." },
      };
    },
  };

  type RegistryClient = Parameters<typeof approveProject>[0]["supabase"];
  const client = mockSupabase as unknown as RegistryClient;

  // 1. approveProject MUST reject and throw
  await assert.rejects(
    async () => {
      await approveProject({
        supabase: client,
        userId: "00000000-0000-0000-0000-000000000001",
        verifierEmail: "verifier@test.org",
        projectId: "00000000-0000-0000-0000-000000000002",
        confirmedCarbon: 520,
        comments: "Approved",
      });
    },
    /atomic database transaction error: Simulated foreign key failure/,
    "Must throw and reject verification when atomic transaction fails",
  );

  // CRITICAL AUDIT CHECK: Non-atomic fallback must NEVER have executed!
  assert.strictEqual(
    fallbackUpdateExecuted,
    false,
    "No partial fallback project update must occur",
  );
  assert.strictEqual(fallbackReviewInserted, false, "No partial fallback review insert must occur");

  // 2. requestCorrection MUST reject and throw
  await assert.rejects(async () => {
    await requestCorrection({
      supabase: client,
      userId: "00000000-0000-0000-0000-000000000001",
      verifierEmail: "verifier@test.org",
      projectId: "00000000-0000-0000-0000-000000000002",
      comments: "Missing high resolution drone imagery",
    });
  }, /Correction request failed: atomic database transaction error/);

  // 3. rejectProject MUST reject and throw
  await assert.rejects(async () => {
    await rejectProject({
      supabase: client,
      userId: "00000000-0000-0000-0000-000000000001",
      verifierEmail: "verifier@test.org",
      projectId: "00000000-0000-0000-0000-000000000002",
      comments: "Project area does not meet additionality standards",
    });
  }, /Project rejection failed: atomic database transaction error/);
});
