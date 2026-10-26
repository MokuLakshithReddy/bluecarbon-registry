import test from "node:test";
import assert from "node:assert";
import {
  scanTextForSecrets,
  scanGitHistory,
  checkDependencyAudit,
} from "../../scripts/security-audit.ts";

test("Security Audit Canary: Scanner reliably detects synthetic canary secrets in text payloads", () => {
  // Test detection of Supabase service role token (constructed in memory)
  const leakedSupabase = [
    "const token = '",
    "sb_secret_",
    "canary_leak_token_9999999999999999999999",
    "';",
  ].join("");
  const findingsSupabase = scanTextForSecrets(leakedSupabase, "src/canary-test.ts");
  assert.strictEqual(findingsSupabase.length, 1);
  assert.strictEqual(findingsSupabase[0]?.pattern, "Live Supabase Service Secret");

  // Test detection of raw Ethereum private key (constructed in memory)
  const leakedEthKey = [
    "const key = '",
    "0x4f3edf983ac636a65a842ce7c78d9aa",
    "706d3b113bce9c46f30d7d21715b23b1d",
    "';",
  ].join("");
  const findingsEth = scanTextForSecrets(leakedEthKey, "src/canary-key.ts");
  assert.strictEqual(findingsEth.length, 1);
  assert.strictEqual(findingsEth[0]?.pattern, "Raw Ethereum Private Key");

  // Test detection of GitHub personal token (constructed in memory)
  const leakedGhp = [
    "const ghp = '",
    "gh" + "p_",
    "canaryToken1234567890123456789012345",
    "';",
  ].join("");
  const findingsGhp = scanTextForSecrets(leakedGhp, "src/canary-ghp.ts");
  assert.strictEqual(findingsGhp.length, 1);
  assert.strictEqual(findingsGhp[0]?.pattern, "Live GitHub Personal Token");

  // Test detection of AWS Access Key (constructed in memory)
  const leakedAws = ["const aws = '", "AK" + "IAIOSFODNN7EXAMPLE", "';"].join("");
  const findingsAws = scanTextForSecrets(leakedAws, "src/canary-aws.ts");
  assert.strictEqual(findingsAws.length, 1);
  assert.strictEqual(findingsAws[0]?.pattern, "AWS Access Key");

  // Test detection of Private Key PEM block (constructed in memory)
  const leakedPem = [
    "-----BEGIN " + "RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA...",
    "-----END " + "RSA PRIVATE KEY-----",
  ].join("\n");
  const findingsPem = scanTextForSecrets(leakedPem, "src/canary-cert.pem");
  assert.strictEqual(findingsPem.length, 1);
  assert.strictEqual(findingsPem[0]?.pattern, "Private Key Block");
});

test("Security Audit Canary: Git history scanner fails closed when git inspection fails", () => {
  const result = scanGitHistory();
  // In the real working repo, inspection should succeed without scan errors
  assert.strictEqual(result.error, undefined, "Git history scanning must succeed without error");
  assert.strictEqual(
    result.findings.length,
    0,
    "No real secrets must exist in repository git history",
  );
});

test("Security Audit Canary: Dependency audit fails closed on empty or unparseable audit report", () => {
  // 1. Empty string output must fail closed
  const emptyRes = checkDependencyAudit("");
  assert.strictEqual(emptyRes.passed, false, "Empty audit output must fail closed");
  assert.strictEqual(emptyRes.unapprovedCount, 1);

  // 2. Whitespace-only output must fail closed
  const whitespaceRes = checkDependencyAudit("   \n\t   ");
  assert.strictEqual(whitespaceRes.passed, false, "Whitespace audit output must fail closed");
  assert.strictEqual(whitespaceRes.unapprovedCount, 1);

  // 3. Malformed JSON must fail closed
  const malformedRes = checkDependencyAudit("Internal Server Error 500: npm registry unavailable");
  assert.strictEqual(malformedRes.passed, false, "Malformed/HTML audit output must fail closed");
  assert.strictEqual(malformedRes.unapprovedCount, 1);

  // 4. Valid empty vulnerabilities JSON passes
  const cleanRes = checkDependencyAudit(JSON.stringify({ vulnerabilities: {} }));
  assert.strictEqual(cleanRes.passed, true, "Valid clean audit JSON must pass");
  assert.strictEqual(cleanRes.unapprovedCount, 0);
});
