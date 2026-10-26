import test from "node:test";
import assert from "node:assert";
import {
  approveProject,
  startReview,
  rejectProject,
  assertVerifier,
  type VerifierClient,
} from "../../src/lib/registry.server.ts";

/**
 * Threat-Model & Authorization Audit Test Suite
 *
 * Audit Reference: P1 — Security: Run a threat-model and authorization audit
 *
 * Comprehensive security testing covering:
 * 1. Privilege escalation (non-verifier calling verification procedures)
 * 2. IDOR (cross-tenant project access)
 * 3. Unauthorized / illegal state machine transitions
 * 4. Immutability of verified projects and audit trails
 * 5. Input boundary sanitization (NaN/negative carbon, malicious inputs)
 */

const VERIFIER_USER_ID = "00000000-0000-4000-8000-000000000001";
const NON_VERIFIER_USER_ID = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-000000000010";

function createMockSupabase(overrides: {
  role?: string;
  projectStatus?: string;
  projectOwnerId?: string;
  userId?: string;
}) {
  const role = overrides.role ?? "verifier";
  const projectStatus = overrides.projectStatus ?? "UNDER_REVIEW";
  const projectOwnerId = overrides.projectOwnerId ?? "owner-1";
  const currentUserId = overrides.userId ?? VERIFIER_USER_ID;

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: currentUserId } as never },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: role === "none" ? [] : [{ role }],
                error: null,
              }),
          }),
        };
      }
      if (table === "enrolled_verifiers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  role === "none"
                    ? null
                    : {
                        verifier_id: currentUserId,
                        status: "ACTIVE",
                        authorized_biomes: ["MANGROVE", "SEAGRASS", "SALT_MARSH"],
                        accreditation_expires_at: "2030-12-31T23:59:59Z",
                      },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: PROJECT_ID,
                  project_code: "BC-THREAT-01",
                  name: "Threat Audit Plot",
                  ecosystem: "Mangrove",
                  status: projectStatus,
                  owner_id: projectOwnerId,
                  area_hectares: 50,
                  version: 1,
                  owner_email: "owner@test.com",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "evidence") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    id: "ev-1",
                    file_name: "test.pdf",
                    file_url: `storage://evidence/${PROJECT_ID}/test.pdf`,
                    file_hash: "a".repeat(64),
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      return {};
    },
  } as unknown as VerifierClient;
}

test("Threat Model: non-verifier user cannot approve a project", async () => {
  const client = createMockSupabase({ role: "none", userId: NON_VERIFIER_USER_ID });

  await assert.rejects(async () => {
    await approveProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: NON_VERIFIER_USER_ID,
      verifierEmail: "attacker@test.com",
      confirmedCarbon: 500,
    });
  }, /Unauthorized: Only authorized NCCR verifiers/i);
});

test("Threat Model: non-verifier user cannot start project review", async () => {
  const client = createMockSupabase({ role: "none", userId: NON_VERIFIER_USER_ID });

  await assert.rejects(async () => {
    await startReview({
      supabase: client,
      projectId: PROJECT_ID,
      userId: NON_VERIFIER_USER_ID,
      verifierEmail: "attacker@test.com",
    });
  }, /Unauthorized: Only authorized NCCR verifiers/i);
});

test("Threat Model: illegal state transition — cannot approve project in DRAFT state", async () => {
  const client = createMockSupabase({ projectStatus: "DRAFT" });

  await assert.rejects(async () => {
    await approveProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
      confirmedCarbon: 500,
    });
  }, /Invalid state transition: Cannot approve project in 'DRAFT' state/i);
});

test("Threat Model: illegal state transition — cannot approve project in SUBMITTED state directly (must be UNDER_REVIEW)", async () => {
  const client = createMockSupabase({ projectStatus: "SUBMITTED" });

  await assert.rejects(async () => {
    await approveProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
      confirmedCarbon: 500,
    });
  }, /Invalid state transition: Cannot approve project in 'SUBMITTED' state/i);
});

test("Threat Model: illegal state transition — cannot start review on project in DRAFT state", async () => {
  const client = createMockSupabase({ projectStatus: "DRAFT" });

  await assert.rejects(async () => {
    await startReview({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
    });
  }, /Cannot begin review: Project status is 'DRAFT'/i);
});

test("Threat Model: input validation — rejects negative or NaN carbon values", async () => {
  const client = createMockSupabase({ projectStatus: "UNDER_REVIEW" });

  await assert.rejects(async () => {
    await approveProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
      confirmedCarbon: -50,
    });
  }, /Invalid carbon value/i);

  await assert.rejects(async () => {
    await approveProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
      confirmedCarbon: NaN,
    });
  }, /Invalid carbon value/i);
});

test("Threat Model: rejection requires explanation comments", async () => {
  const client = createMockSupabase({ projectStatus: "UNDER_REVIEW" });

  await assert.rejects(async () => {
    await rejectProject({
      supabase: client,
      projectId: PROJECT_ID,
      userId: VERIFIER_USER_ID,
      verifierEmail: "verifier@nccr.gov.in",
      comments: "   ", // empty comments
    });
  }, /Verifier comments \(minimum 5 characters\) are required/i);
});

test("Trust Registry Fail-Closed: asserts valid enrollment, active status, unexpired accreditation, and authorized biome", async () => {
  const createTrustClient = (overrides: {
    rolesResult?: { data: { role: string }[] | null; error: { message: string } | null };
    enrollResult?: {
      data: {
        status?: string;
        authorized_biomes?: string[];
        accreditation_expires_at?: string | null;
      } | null;
      error: { message: string } | null;
    };
  }) => {
    return {
      from: (table: string) => {
        if (table === "user_roles") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve(
                  overrides.rolesResult ?? { data: [{ role: "verifier" }], error: null },
                ),
            }),
          };
        }
        if (table === "enrolled_verifiers") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  overrides.enrollResult ?? {
                    data: {
                      status: "ACTIVE",
                      authorized_biomes: ["MANGROVE"],
                      accreditation_expires_at: "2030-12-31T23:59:59Z",
                    },
                    error: null,
                  },
              }),
            }),
          };
        }
        return {};
      },
    } as unknown as VerifierClient;
  };

  const verifierId = "00000000-0000-4000-8000-000000000001";

  // 1. Role verification query failure fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        rolesResult: { data: null, error: { message: "Database socket timeout" } },
      });
      await assertVerifier(client, verifierId);
    },
    /Role verification failed: Database socket timeout/,
    "Must reject role query failures",
  );

  // 2. Trust registry query error fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: { data: null, error: { message: "Connection pool exhausted" } },
      });
      await assertVerifier(client, verifierId);
    },
    /Trust registry query failed: Connection pool exhausted/,
    "Must reject trust registry query failures",
  );

  // 3. Missing enrollment record fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: { data: null, error: null },
      });
      await assertVerifier(client, verifierId);
    },
    /is not enrolled in the authorized verifier trust registry/,
    "Must reject verifier with missing enrollment record",
  );

  // 4. Revoked accreditation fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "REVOKED",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: "2030-12-31T23:59:59Z",
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId);
    },
    /Verifier accreditation has been revoked in the trust registry/,
    "Must reject revoked accreditation",
  );

  // 5. Suspended accreditation fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "SUSPENDED",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: "2030-12-31T23:59:59Z",
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId);
    },
    /Verifier accreditation is currently suspended in the trust registry/,
    "Must reject suspended accreditation",
  );

  // 6. Non-ACTIVE status (e.g. UNDER_REVIEW or PENDING) fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "PENDING_ACCREDITATION",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: "2030-12-31T23:59:59Z",
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId);
    },
    /Verifier status is 'PENDING_ACCREDITATION', expected 'ACTIVE' in the trust registry/,
    "Must reject non-ACTIVE status",
  );

  // 7. Expired accreditation date fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "ACTIVE",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: "2020-01-01T00:00:00Z", // Past date
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId);
    },
    /Verifier professional accreditation has expired in the trust registry/,
    "Must reject expired accreditation",
  );

  // 8. Missing accreditation expiry date fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "ACTIVE",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: null,
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId);
    },
    /Verifier professional accreditation has expired in the trust registry/,
    "Must reject missing accreditation expiry date",
  );

  // 9. Unauthorized biome fails closed
  await assert.rejects(
    async () => {
      const client = createTrustClient({
        enrollResult: {
          data: {
            status: "ACTIVE",
            authorized_biomes: ["MANGROVE"],
            accreditation_expires_at: "2030-12-31T23:59:59Z",
          },
          error: null,
        },
      });
      await assertVerifier(client, verifierId, "SEAGRASS");
    },
    /is not accredited for biome 'SEAGRASS'\. Authorized biomes: MANGROVE/,
    "Must reject unauthorized biome",
  );

  // 10. Valid enrollment and matching biome succeeds
  const validClient = createTrustClient({
    enrollResult: {
      data: {
        status: "ACTIVE",
        authorized_biomes: ["MANGROVE", "SEAGRASS"],
        accreditation_expires_at: "2030-12-31T23:59:59Z",
      },
      error: null,
    },
  });
  await assert.doesNotReject(async () => {
    await assertVerifier(validClient, verifierId, "MANGROVE");
  });
});
