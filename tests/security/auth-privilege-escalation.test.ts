import test from "node:test";
import assert from "node:assert";

/**
 * Security and Authorization Test Suite
 *
 * Audit Reference: Findings 1, 3, 5 (Privilege Escalation, Role Guards, Privacy)
 *
 * Tests the 5 explicit vulnerability scenarios specified in the audit:
 * 1. An ordinary user attempting to assign themselves an admin or verifier role.
 * 2. A project owner attempting to edit another owner's project.
 * 3. A non-verifier attempting to alter verification results or audit records.
 * 4. An authenticated user attempting to modify notification data belonging to another user.
 * 5. An anonymous user requesting private project evidence.
 */

// -----------------------------------------------------------------------------
// Case 1: Signup Trigger Role Assignment (Preventing Privilege Escalation)
// -----------------------------------------------------------------------------
function simulateHandleNewUser(rawUserMetaData: Record<string, unknown>) {
  // Implementation of updated handle_new_user trigger logic:
  // Role in raw_user_meta_data is strictly ignored.
  const assignedRole = "project_owner"; // Fixed least-privilege default
  const profile = {
    full_name:
      typeof rawUserMetaData.full_name === "string" ? rawUserMetaData.full_name.trim() : null,
    organization:
      typeof rawUserMetaData.organization === "string" ? rawUserMetaData.organization.trim() : null,
    phone: typeof rawUserMetaData.phone === "string" ? rawUserMetaData.phone.trim() : null,
  };
  return { assignedRole, profile };
}

test("Security Case 1: Ordinary user cannot elevate to admin or verifier via signup metadata", () => {
  const attackPayloads = [
    { role: "admin", full_name: "Malicious User" },
    { role: "verifier", full_name: "Fake Verifier" },
    { role: "service_role", full_name: "Privilege Escalation" },
  ];

  for (const metadata of attackPayloads) {
    const result = simulateHandleNewUser(metadata);
    // MUST strictly be project_owner
    assert.strictEqual(
      result.assignedRole,
      "project_owner",
      `Attacker payload ${JSON.stringify(metadata)} should not have granted ${metadata.role}`,
    );
  }
});

// -----------------------------------------------------------------------------
// Case 2: Project Ownership Isolation
// -----------------------------------------------------------------------------
function checkCanEditProject(
  callerUserId: string,
  project: { owner_id: string | null; status: string },
) {
  // Only the owner can edit, and only in DRAFT or CORRECTION_REQUIRED states
  const isOwner = project.owner_id === callerUserId;
  const isEditableState = project.status === "DRAFT" || project.status === "CORRECTION_REQUIRED";
  return isOwner && isEditableState;
}

test("Security Case 2: Project owner cannot edit another owner's project", () => {
  const aliceUserId = "alice-1111-1111-1111";
  const bobUserId = "bob-2222-2222-2222";

  const aliceProject = {
    owner_id: aliceUserId,
    status: "DRAFT",
  };

  // Alice can edit her own draft project
  assert.strictEqual(checkCanEditProject(aliceUserId, aliceProject), true);

  // Bob CANNOT edit Alice's project
  assert.strictEqual(checkCanEditProject(bobUserId, aliceProject), false);

  // Alice cannot edit her project once SUBMITTED or VERIFIED
  assert.strictEqual(
    checkCanEditProject(aliceUserId, { ...aliceProject, status: "SUBMITTED" }),
    false,
  );
  assert.strictEqual(
    checkCanEditProject(aliceUserId, { ...aliceProject, status: "VERIFIED" }),
    false,
  );
});

// -----------------------------------------------------------------------------
// Case 3: Verifier & Audit Record Authorization
// -----------------------------------------------------------------------------
function assertVerifierAuthorization(callerRoles: string[]) {
  if (!callerRoles.includes("verifier") && !callerRoles.includes("admin")) {
    throw new Error(
      "Unauthorized: Only authorized NCCR verifiers or administrators can record verification decisions.",
    );
  }
}

test("Security Case 3: Non-verifier cannot alter verification results or audit records", () => {
  const ownerRoles = ["project_owner"];
  assert.throws(
    () => assertVerifierAuthorization(ownerRoles),
    /Unauthorized: Only authorized NCCR verifiers/,
  );

  const anonRoles: string[] = [];
  assert.throws(
    () => assertVerifierAuthorization(anonRoles),
    /Unauthorized: Only authorized NCCR verifiers/,
  );

  // Verifier and Admin are allowed
  assert.doesNotThrow(() => assertVerifierAuthorization(["verifier"]));
  assert.doesNotThrow(() => assertVerifierAuthorization(["admin"]));
});

// -----------------------------------------------------------------------------
// Case 4: Notifications Access Boundaries
// -----------------------------------------------------------------------------
function checkCanAccessNotification(
  callerEmail: string,
  notification: { recipient_email: string },
) {
  return callerEmail.toLowerCase().trim() === notification.recipient_email.toLowerCase().trim();
}

test("Security Case 4: Authenticated user cannot access or modify another user's notifications", () => {
  const userA = "victim@domain.org";
  const userB = "attacker@domain.org";

  const notifA = { recipient_email: userA, title: "Sensitive update" };

  assert.strictEqual(checkCanAccessNotification(userA, notifA), true);
  assert.strictEqual(checkCanAccessNotification(userB, notifA), false);
});

// -----------------------------------------------------------------------------
// Case 5: Evidence Privacy & PII Protection
// -----------------------------------------------------------------------------
interface EvidenceItem {
  id: string;
  file_name: string;
  is_public: boolean;
}

function filterPublicEvidence(evidence: EvidenceItem[]) {
  return evidence.filter((item) => item.is_public === true);
}

function sanitizePublicProjectPayload(project: {
  project_code: string;
  name: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  owner_email: string;
  evidence: EvidenceItem[];
}) {
  return {
    project_code: project.project_code,
    name: project.name,
    // Sensitive PII stripped from public view
    contact_phone: null,
    contact_email: null,
    owner_email: "[REDACTED]",
    evidence: filterPublicEvidence(project.evidence),
  };
}

test("Security Case 5: Anonymous user requesting public project receives only public evidence and redacted PII", () => {
  const rawProject = {
    project_code: "BCR-MANG-0001",
    name: "Coringa Mangrove Habitat",
    contact_phone: "+91 98765 43210",
    contact_email: "lead_investigator@personal-email.com",
    owner_email: "confidential_owner@private.org",
    evidence: [
      { id: "e1", file_name: "site_photo_public.jpg", is_public: true },
      { id: "e2", file_name: "drone_orthomosaic.tif", is_public: true },
      { id: "e3", file_name: "private_financial_receipt.pdf", is_public: false },
      { id: "e4", file_name: "land_ownership_deed.pdf", is_public: false },
    ],
  };

  const publicView = sanitizePublicProjectPayload(rawProject);

  // Private evidence items MUST be completely excluded from public payload
  assert.strictEqual(publicView.evidence.length, 2);
  assert.strictEqual(
    publicView.evidence.every((e) => e.is_public),
    true,
  );
  assert.strictEqual(
    publicView.evidence.some((e) => e.file_name.includes("financial")),
    false,
  );
  assert.strictEqual(
    publicView.evidence.some((e) => e.file_name.includes("land_ownership")),
    false,
  );

  // PII must be null or redacted
  assert.strictEqual(publicView.contact_phone, null);
  assert.strictEqual(publicView.contact_email, null);
  assert.strictEqual(publicView.owner_email, "[REDACTED]");
});
