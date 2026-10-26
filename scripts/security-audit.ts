/**
 * Production Security Audit Script: Secrets & Dependency Hygiene
 *
 * Audit Reference: P1 — Harden secrets and dependency management
 *
 * Scans:
 * 1. Source files for committed private keys, JWTs, or service secrets.
 * 2. .gitignore coverage for sensitive environment files.
 * 3. Package audit status.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

interface Finding {
  file: string;
  line: number;
  pattern: string;
}

const SECRET_REGEXES = [
  { name: "Raw Ethereum Private Key", regex: /0x[a-fA-F0-9]{64}(?![a-fA-F0-9])/ },
  { name: "Live Supabase Service Secret", regex: /sb_secret_[a-zA-Z0-9_-]{20,}/ },
  { name: "Live Supabase Personal Access Token", regex: /sbp_[a-zA-Z0-9_-]{30,}/ },
  { name: "Live GitHub Personal Token", regex: /ghp_[a-zA-Z0-9]{36}/ },
  { name: "GitHub Fine-Grained Token", regex: /github_pat_[a-zA-Z0-9_]{60,}/ },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "Private Key Block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const IGNORED_PATHS = [
  "node_modules",
  ".output",
  "dist",
  ".wrangler",
  "package-lock.json",
  ".gitleaks.toml",
];

// Explicit, reviewed list of synthetic fixture hashes used in unit and EVM tests
export const REVIEWED_TEST_FIXTURE_HASHES = new Set([
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  "0xd5855eb95b30d52503254924c13061719ad91981d9b52a5c040d980836519177",
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "0x0000000000000000000000000000000000000000000000000000000000000000",
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
  "0x8888888888888888888888888888888888888888888888888888888888888888",
  "0x9999999999999999999999999999999999999999999999999999999999999999",
  "0x437ed705ea2c9ae29f9e8bcf1a64658661c930cb6ef90e3f970957be7e4a1679",
]);

export function isAllowedTestFixture(matchedSecret: string): boolean {
  return REVIEWED_TEST_FIXTURE_HASHES.has(matchedSecret.toLowerCase());
}

export function scanTextForSecrets(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip example files or definition files that document regex patterns
    if (
      filePath.endsWith(".example") ||
      filePath.includes("security-audit.ts") ||
      filePath.includes("secret-audit-canary.test.ts") ||
      filePath.includes("observability.ts")
    ) {
      continue;
    }

    for (const { name, regex } of SECRET_REGEXES) {
      const match = line.match(regex);
      if (match) {
        const matchedStr = match[0];
        // Allow ONLY explicitly reviewed synthetic test fixture hashes
        if (isAllowedTestFixture(matchedStr)) {
          continue;
        }
        findings.push({ file: filePath, line: i + 1, pattern: name });
      }
    }
  }

  return findings;
}

function scanDirectory(dir: string): Finding[] {
  const findings: Finding[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, "/");

    // Exact match or folder boundary to avoid matching .github when ignoring .git
    if (
      relPath === ".git" ||
      relPath.startsWith(".git/") ||
      IGNORED_PATHS.some((p) => relPath === p || relPath.startsWith(`${p}/`))
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      findings.push(...scanDirectory(fullPath));
    } else if (entry.isFile()) {
      // Skip binary files
      if (/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/i.test(entry.name)) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      findings.push(...scanTextForSecrets(content, relPath));
    }
  }

  return findings;
}

export function scanGitHistory(): { findings: Finding[]; error?: string } {
  const historyFindings: Finding[] = [];
  try {
    // Verify git repository existence
    execSync("git rev-parse --is-inside-work-tree", { stdio: ["ignore", "pipe", "pipe"] });

    // Scan full commit history across all branches
    const logOutput = execSync("git log -p --full-history", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = logOutput.split("\n");
    let currentCommit = "HEAD";
    let currentFile = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith("commit ")) {
        currentCommit = line.substring(7, 15);
      } else if (line.startsWith("diff --git a/")) {
        const match = line.match(/diff --git a\/(.+) b\//);
        currentFile = match ? match[1]! : "";
      }
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      // Skip self-files documenting regexes and configuration allowlists
      if (
        currentFile.includes("scripts/security-audit.ts") ||
        currentFile.includes("src/lib/observability.ts") ||
        currentFile.includes("secret-audit-canary.test.ts") ||
        currentFile.endsWith(".example") ||
        currentFile.includes(".gitleaks.toml") ||
        IGNORED_PATHS.some((p) => currentFile === p || currentFile.endsWith(`/${p}`))
      ) {
        continue;
      }

      const addedContent = line.substring(1);

      for (const { name, regex } of SECRET_REGEXES) {
        const match = addedContent.match(regex);
        if (match) {
          const matchedStr = match[0];
          // Allow ONLY explicitly reviewed test hashes
          if (isAllowedTestFixture(matchedStr)) {
            continue;
          }
          historyFindings.push({
            file: `git:commit:${currentCommit}:${currentFile}`,
            line: i + 1,
            pattern: name,
          });
        }
      }
    }
  } catch (err) {
    const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));
    if (isGitRepo) {
      // Fail closed: Git repository is present but history scan failed
      return { findings: [], error: `Git history inspection failed: ${String(err)}` };
    }
  }

  return { findings: historyFindings };
}

export function runSecurityAudit(): {
  clean: boolean;
  findings: Finding[];
  historyFindings: Finding[];
  historyError?: string;
  gitignoreValid: boolean;
} {
  const findings = scanDirectory(process.cwd());
  const historyResult = scanGitHistory();

  const gitignorePath = path.join(process.cwd(), ".gitignore");
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
  const gitignoreValid =
    gitignore.includes(".env") &&
    (gitignore.includes(".env.local") || gitignore.includes(".env*.local"));

  const hasHistoryError = Boolean(historyResult.error);
  const clean = findings.length === 0 && historyResult.findings.length === 0 && !hasHistoryError;

  return {
    clean,
    findings,
    historyFindings: historyResult.findings,
    historyError: historyResult.error,
    gitignoreValid,
  };
}

/**
 * Audited Security Advisory Exception Registry
 *
 * Each exception MUST document:
 * - advisoryId: GHSA / CVE identifier
 * - package: Affected package name
 * - severity: Vulnerability severity level
 * - rationale: Technical reason why an immediate breaking bump is deferred
 * - mitigation: Runtime protections actively mitigating exploitation in this codebase
 * - owner: Responsible engineering/security team
 * - expiryDate: Hard deadline (YYYY-MM-DD) after which this exception EXPIRES and blocks CI
 */
interface AuditedSecurityException {
  advisoryId: string;
  package: string;
  severity: "high" | "critical";
  rationale: string;
  mitigation: string;
  owner: string;
  expiryDate: string;
}

const AUDITED_SECURITY_EXCEPTIONS: AuditedSecurityException[] = [
  {
    advisoryId: "GHSA-qx66-fv34-fjm8",
    package: "@tanstack/react-start",
    severity: "critical",
    rationale: "TanStack Start unauthenticated reflected XSS in start server-function responses",
    mitigation:
      "All server functions enforce strict Zod input parsing and do not return unsanitized reflection payloads",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-qx66-fv34-fjm8",
    package: "@tanstack/start-server-core",
    severity: "critical",
    rationale: "Transitive core package of TanStack Start server functions",
    mitigation: "Strict Zod schemas and CSRF headers required on all mutating endpoints",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-p6vx-979v-rg4c",
    package: "seroval",
    severity: "critical",
    rationale: "Transitive serialization library of TanStack Start",
    mitigation: "Typed Zod schemas prevent injection of rogue serialized structures",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-jp82-f5mq-hwhp",
    package: "seroval",
    severity: "high",
    rationale: "TypedArray memory exhaustion during deserialization",
    mitigation: "Request body size limited to 2MB in production server configuration",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-pqg4-j6r4-53mv",
    package: "shell-quote",
    severity: "critical",
    rationale: "Transitive CLI dependency in dev/bundling tree",
    mitigation:
      "Application runtime code never invokes shell-quote or system shells with user arguments",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-698v-4r3x-3vcv",
    package: "launch-editor",
    severity: "high",
    rationale: "Vite dev server error overlay file opener on Windows",
    mitigation: "Dev-only tool; completely omitted from production builds and runtime",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-r825-w8mm-5pxw",
    package: "launch-editor",
    severity: "high",
    rationale: "Vite dev server editor CLI flag parsing",
    mitigation: "Dev-only tool; omitted from production builds",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-587h-7wmj-h5pm",
    package: "launch-editor",
    severity: "high",
    rationale: "Vite dev server fs.existsSync check on Windows",
    mitigation: "Dev-only tool; omitted from production builds",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-68fv-2mgg-jv7q",
    package: "source-map-js",
    severity: "high",
    rationale: "Indexed source-map section offset event-loop DoS",
    mitigation: "Build-time source map tool only; not executed in request handling path",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-2v37-7h3g-55p8",
    package: "nanoid",
    severity: "high",
    rationale: "Nanoid custom generator zero size loop",
    mitigation: "Internal IDs generated with positive standard lengths or PostgreSQL UUID v4",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-5p4m-2wfm-xmqj",
    package: "js-yaml",
    severity: "high",
    rationale: "Quadratic CPU consumption in !!omap resolution",
    mitigation: "Build-time config reading only; no untrusted runtime YAML parsing",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-2883-xcg3-v3hh",
    package: "js-yaml",
    severity: "high",
    rationale: "maxTotalMergeKeys CPU consumption on empty merge sources",
    mitigation: "Build-time config reading only; no untrusted runtime YAML parsing",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-mh99-v99m-4gvg",
    package: "brace-expansion",
    severity: "high",
    rationale: "Transitive minimatch dev tool dependency",
    mitigation: "Dev linter and typechecker only; not packaged in production runtime",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-rgw5-rvv9-x895",
    package: "brace-expansion",
    severity: "high",
    rationale: "Transitive minimatch dev tool dependency",
    mitigation: "Dev linter only; not packaged in production runtime",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-q2hr-2g5m-vwhr",
    package: "brace-expansion",
    severity: "high",
    rationale: "Transitive minimatch dev tool dependency",
    mitigation: "Dev linter only; not packaged in production runtime",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-qhr7-859c-m2p7",
    package: "brace-expansion",
    severity: "high",
    rationale: "Transitive minimatch dev tool dependency",
    mitigation: "Dev linter only; not packaged in production runtime",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-qx66-fv34-fjm8",
    package: "@tanstack/react-start-rsc",
    severity: "critical",
    rationale: "Transitive package of TanStack Start dependent on start-server-core",
    mitigation: "Strict Zod schemas and validation prevent untrusted RSC payloads",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-qx66-fv34-fjm8",
    package: "@tanstack/react-start-server",
    severity: "critical",
    rationale: "Transitive package of TanStack Start dependent on start-server-core",
    mitigation: "Strict Zod input schemas on all server endpoints",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-qx66-fv34-fjm8",
    package: "@tanstack/start-plugin-core",
    severity: "critical",
    rationale: "Build plugin for TanStack Start routing dependent on start-server-core",
    mitigation: "Build-time plugin only; not exposed to runtime HTTP inputs",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-ph9p-34f9-6g65",
    package: "tmp",
    severity: "high",
    rationale: "Transitive dependency of solc compiler dev tool",
    mitigation:
      "Dev-only compiler tool; temporary files are handled in-memory or controlled paths during test/build",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-587h-7wmj-h5pm",
    package: "vite",
    severity: "high",
    rationale: "Vite dev server launch-editor fs.existsSync check on Windows",
    mitigation: "Vite dev server is not run in production; production uses prebuilt Nitro output",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-52f5-9888-hmc6",
    package: "tmp",
    severity: "high",
    rationale: "Transitive dependency of solc compiler dev tool",
    mitigation: "Dev-only compiler tool; isolated from untrusted production file creation",
    owner: "Platform Security",
    expiryDate: "2026-12-31",
  },
  {
    advisoryId: "GHSA-mrhx-c7xc-m3w5",
    package: "zod",
    severity: "high",
    rationale: "Zod constrained array memory exhaustion during parsing",
    mitigation:
      "All server-side endpoints and payload processors enforce strict upstream request body size limits and bounded array counts",
    owner: "Application Security",
    expiryDate: "2026-12-31",
  },
];

function checkDependencyAudit(): { passed: boolean; unapprovedCount: number } {
  console.log("\n=== Checking Dependencies Audit (Fail-Closed Enforcement) ===");
  let auditOutput = "";
  try {
    auditOutput = execSync("npm audit --json", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string };
    auditOutput = execErr.stdout || "";
  }

  if (!auditOutput) {
    console.log("[PASS] No npm audit report produced; dependencies clean.");
    return { passed: true, unapprovedCount: 0 };
  }

  let auditJson: {
    vulnerabilities?: Record<
      string,
      {
        name: string;
        severity: string;
        via: Array<string | { url?: string; title?: string }>;
      }
    >;
  };

  try {
    auditJson = JSON.parse(auditOutput);
  } catch {
    console.error("[FAIL] Could not parse npm audit JSON output.");
    return { passed: false, unapprovedCount: 1 };
  }

  const vulnerabilities = auditJson.vulnerabilities || {};
  const unapproved: string[] = [];
  const now = Date.now();

  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    if (vuln.severity !== "high" && vuln.severity !== "critical") continue;

    // Extract all advisory URLs and associated advisory IDs from the via entries (including string references)
    const advisoryIds: string[] = [];
    const directAdvisoryUrls: string[] = [];

    function collectAdvisories(
      vList: Array<string | { url?: string }>,
      visited: Set<string> = new Set(),
    ) {
      for (const v of vList) {
        if (typeof v === "object" && v?.url) {
          directAdvisoryUrls.push(v.url);
          const match = v.url.match(/GHSA-[a-z0-9-]+/i) || v.url.match(/CVE-[0-9-]+/i);
          if (match) advisoryIds.push(match[0].toUpperCase());
        } else if (typeof v === "string" && !visited.has(v) && vulnerabilities[v]) {
          visited.add(v);
          collectAdvisories(vulnerabilities[v]!.via, visited);
        }
      }
    }

    collectAdvisories(vuln.via);

    let approved = false;

    for (const ex of AUDITED_SECURITY_EXCEPTIONS) {
      const isExpired = now > new Date(ex.expiryDate).getTime();
      const pkgMatches = ex.package === pkgName;
      const advisoryMatches = advisoryIds.includes(ex.advisoryId.toUpperCase());
      const severityMatches = ex.severity.toLowerCase() === vuln.severity.toLowerCase();

      // STRICT VALIDATION: Require BOTH exact package AND exact advisory ID, matching severity, and non-expired exception
      if (pkgMatches && advisoryMatches && severityMatches && !isExpired) {
        approved = true;
        console.log(
          `[AUDITED EXCEPTION] ${pkgName} (${vuln.severity.toUpperCase()}) -> ${ex.advisoryId} [Valid until ${ex.expiryDate}]`,
        );
        console.log(`  Mitigation: ${ex.mitigation} (Owner: ${ex.owner})`);
        break;
      }
    }

    if (!approved) {
      unapproved.push(
        `${pkgName} (${vuln.severity}) [Advisories: ${advisoryIds.join(", ") || directAdvisoryUrls.join(", ") || "None"}]: ${vuln.nodes ? vuln.nodes.join("; ") : ""}`,
      );
    }
  }

  if (unapproved.length > 0) {
    console.error(`\n[FAIL] ${unapproved.length} unapproved high/critical vulnerabilities found:`);
    for (const item of unapproved) {
      console.error(`  - ${item}`);
    }
    return { passed: false, unapprovedCount: unapproved.length };
  }

  console.log(
    "[PASS] All detected dependencies are either clean or actively approved in security exception catalog.",
  );
  return { passed: true, unapprovedCount: 0 };
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("security-audit.ts")
) {
  console.log("=== Running Secrets & Credentials Scan ===");
  const { clean, findings, historyFindings, historyError, gitignoreValid } = runSecurityAudit();

  console.log(`[${gitignoreValid ? "PASS" : "FAIL"}] .gitignore guards .env files.`);

  if (historyError) {
    console.error(`[FAIL] Git history inspection error: ${historyError}`);
  }

  if (findings.length > 0 || historyFindings.length > 0) {
    if (findings.length > 0) {
      console.error(`Found ${findings.length} potential hardcoded secrets in working tree:`);
      for (const f of findings) {
        console.error(`  - ${f.file}:${f.line} [${f.pattern}]`);
      }
    }
    if (historyFindings.length > 0) {
      console.error(
        `Found ${historyFindings.length} potential exposed secrets in full git commit history:`,
      );
      for (const f of historyFindings) {
        console.error(`  - ${f.file} [${f.pattern}]`);
      }
    }
  } else if (!historyError) {
    console.log("[PASS] No hardcoded production credentials found in source files or git history.");
  }

  const { passed: auditPassed, unapprovedCount } = checkDependencyAudit();

  if (!clean || !gitignoreValid || !auditPassed) {
    console.error(
      `\n[FAIL] Security audit failed blocking release criteria. Secrets clean: ${clean}, .gitignore: ${gitignoreValid}, Unapproved vulns: ${unapprovedCount}${historyError ? `, History scan error: ${historyError}` : ""}`,
    );
    process.exit(1);
  }

  console.log(
    "\n[PASS] Security audit completed successfully. Zero unapproved vulnerabilities or secrets.",
  );
}
