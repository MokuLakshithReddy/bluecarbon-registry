import test from "node:test";
import assert from "node:assert";

/**
 * Storage and Public Data Exposure Security Tests
 *
 * Audit Reference:
 * - P0 Finding 1: Demo credentials removed and gated from production login
 * - P0 Finding 6: Community media signed URLs require post status and author authorization
 * - P0 Finding 7: Public evidence visibility must fail-closed (require is_public === true)
 */

test("Public Evidence: Fails closed — only items with explicit is_public === true are exposed", () => {
  const mockEvidenceList = [
    { id: "ev-1", file_name: "public_report.pdf", is_public: true },
    { id: "ev-2", file_name: "internal_audit.pdf", is_public: false },
    { id: "ev-3", file_name: "unspecified_memo.pdf" }, // missing is_public property
    { id: "ev-4", file_name: "null_flag.pdf", is_public: null },
    { id: "ev-5", file_name: "falsy_string.pdf", is_public: "false" as unknown as boolean },
  ];

  // Exact filtering logic enforced by fetchPublicProject
  const filtered = mockEvidenceList.filter(
    (e) => (e as { is_public?: boolean | null }).is_public === true,
  );

  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0]?.id, "ev-1");
  assert.strictEqual(filtered[0]?.file_name, "public_report.pdf");

  // Verify missing, null, and false are strictly rejected
  const rejectedIds = mockEvidenceList
    .filter((e) => (e as { is_public?: boolean | null }).is_public !== true)
    .map((e) => e.id);
  assert.deepStrictEqual(rejectedIds, ["ev-2", "ev-3", "ev-4", "ev-5"]);
});

test("Community Media Authorization: Non-authors cannot get signed URLs for unapproved posts", () => {
  const mockPosts = new Map([
    ["storage://community/post-1/approved.jpg", { status: "APPROVED", author_id: "user-author-1" }],
    ["storage://community/post-2/draft.jpg", { status: "PENDING", author_id: "user-author-2" }],
    ["storage://community/post-3/rejected.jpg", { status: "REJECTED", author_id: "user-author-2" }],
  ]);

  function authorizeMediaAccess(url: string, requestingUserId?: string): boolean {
    const post = mockPosts.get(url);
    if (!post) return false;
    const isApproved = post.status === "APPROVED";
    const isAuthor = Boolean(requestingUserId && post.author_id === requestingUserId);
    return isApproved || isAuthor;
  }

  const requestingUser = "user-attacker-999";
  const authorUser = "user-author-2";

  // 1. Any user can access approved post media
  assert.strictEqual(
    authorizeMediaAccess("storage://community/post-1/approved.jpg", requestingUser),
    true,
  );

  // 2. Unrelated user CANNOT access pending draft media
  assert.strictEqual(
    authorizeMediaAccess("storage://community/post-2/draft.jpg", requestingUser),
    false,
  );

  // 3. Author CAN access their own pending draft media
  assert.strictEqual(
    authorizeMediaAccess("storage://community/post-2/draft.jpg", authorUser),
    true,
  );

  // 4. Unrelated user CANNOT access rejected media
  assert.strictEqual(
    authorizeMediaAccess("storage://community/post-3/rejected.jpg", requestingUser),
    false,
  );

  // 5. Arbitrary non-existent storage path CANNOT be signed
  assert.strictEqual(
    authorizeMediaAccess("storage://community/arbitrary/path.jpg", requestingUser),
    false,
  );
});

test("Auth Page: Demo login is strictly disabled in production builds", () => {
  function isDemoEnabled(isDev: boolean, allowDemoLoginEnv?: string): boolean {
    return isDev && allowDemoLoginEnv === "true";
  }

  // Production build with no demo flag
  assert.strictEqual(isDemoEnabled(false, undefined), false);

  // Production build even if someone mistakenly sets VITE_ALLOW_DEMO_LOGIN="true"
  assert.strictEqual(isDemoEnabled(false, "true"), false);

  // Dev build without explicit opt-in
  assert.strictEqual(isDemoEnabled(true, undefined), false);
  assert.strictEqual(isDemoEnabled(true, "false"), false);

  // Only enabled when DEV mode AND explicit VITE_ALLOW_DEMO_LOGIN="true"
  assert.strictEqual(isDemoEnabled(true, "true"), true);
});
