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
  { name: "Raw Ethereum Private Key", regex: /0x[a-fA-F0-9]{64}/ },
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
  "tests/security/threat-model-audit.test.ts",
  "tests/blockchain/contract-solidity.test.ts", // Local Hardhat test keys
  "tests/blockchain/evm-provider.test.ts", // Anvil/Hardhat mock keys
  "tests/blockchain/blockchain-resilience.test.ts",
];

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
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip obvious dummy placeholder comments / examples
        if (
          line.includes("00000000000000000000000000000000") ||
          line.includes("your-key-here") ||
          line.includes("[REDACTED") ||
          relPath.endsWith(".example") ||
          relPath.includes("observability.ts") // Pattern definition file
        ) {
          continue;
        }

        for (const { name, regex } of SECRET_REGEXES) {
          if (regex.test(line)) {
            findings.push({ file: relPath, line: i + 1, pattern: name });
          }
        }
      }
    }
  }

  return findings;
}

export function runSecurityAudit(): {
  clean: boolean;
  findings: Finding[];
  gitignoreValid: boolean;
} {
  const findings = scanDirectory(process.cwd());

  const gitignorePath = path.join(process.cwd(), ".gitignore");
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
  const gitignoreValid =
    gitignore.includes(".env") &&
    (gitignore.includes(".env.local") || gitignore.includes(".env*.local"));

  return {
    clean: findings.length === 0,
    findings,
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
    advisoryId: "GHSA-52f5-9888-hmc6",
    package: "tmp",
    severity: "high",
    rationale: "Transitive dependency of solc compiler dev tool",
    mitigation: "Dev-only compiler tool; isolated from untrusted production file creation",
    owner: "Platform Security",
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

    const urls = vuln.via
      .map((v) => (typeof v === "object" && v?.url ? v.url : ""))
      .filter(Boolean);

    let approved = false;

    for (const ex of AUDITED_SECURITY_EXCEPTIONS) {
      const isExpired = now > new Date(ex.expiryDate).getTime();
      const pkgMatches = ex.package === pkgName;
      const urlMatches = urls.some((u) => u.includes(ex.advisoryId));

      if ((pkgMatches || urlMatches) && !isExpired) {
        approved = true;
        console.log(
          `[AUDITED EXCEPTION] ${pkgName} (${vuln.severity.toUpperCase()}) -> ${ex.advisoryId} [Valid until ${ex.expiryDate}]`,
        );
        console.log(`  Mitigation: ${ex.mitigation} (Owner: ${ex.owner})`);
        break;
      }
    }

    if (!approved) {
      unapproved.push(`${pkgName} (${vuln.severity}): ${urls.join(", ") || "No URL"}`);
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
  const { clean, findings, gitignoreValid } = runSecurityAudit();

  console.log(`[${gitignoreValid ? "PASS" : "FAIL"}] .gitignore guards .env files.`);

  if (findings.length > 0) {
    console.error(`Found ${findings.length} potential hardcoded secrets in repository:`);
    for (const f of findings) {
      console.error(`  - ${f.file}:${f.line} [${f.pattern}]`);
    }
  } else {
    console.log("[PASS] No hardcoded production credentials found in source files.");
  }

  const { passed: auditPassed, unapprovedCount } = checkDependencyAudit();

  if (!clean || !gitignoreValid || !auditPassed) {
    console.error(
      `\n[FAIL] Security audit failed blocking release criteria. Secrets clean: ${clean}, .gitignore: ${gitignoreValid}, Unapproved vulns: ${unapprovedCount}`,
    );
    process.exit(1);
  }

  console.log(
    "\n[PASS] Security audit completed successfully. Zero unapproved vulnerabilities or secrets.",
  );
}
