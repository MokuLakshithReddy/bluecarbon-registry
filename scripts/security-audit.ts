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
  { name: "Live GitHub Token", regex: /ghp_[a-zA-Z0-9]{36}/ },
];

const IGNORED_PATHS = [
  "node_modules",
  ".git",
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

    if (IGNORED_PATHS.some((p) => relPath.startsWith(p))) continue;

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

  console.log("\n=== Checking Dependencies Audit ===");
  try {
    execSync("npm audit --audit-level=high", { stdio: "inherit" });
    console.log("[PASS] No high or critical package vulnerabilities found.");
  } catch {
    console.warn("[WARN] Some package vulnerabilities reported by npm audit.");
  }

  if (!clean || !gitignoreValid) {
    process.exit(1);
  }
}
