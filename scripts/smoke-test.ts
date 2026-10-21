/**
 * Automated Staging & Production Smoke Test Suite
 *
 * Audit Reference: P2 — Create a repeatable deployment and rollback process
 *
 * Verifies:
 * 1. Web application endpoint responds with HTTP 200
 * 2. Outbox worker /healthz and /readyz endpoints respond OK
 * 3. Supabase database connectivity is active and healthy
 * 4. Blockchain RPC endpoint responds (if configured)
 */

import { ethers } from "ethers";
import { BLUE_CARBON_REGISTRY_ABI } from "../src/lib/blockchain.server.ts";

interface SmokeCheck {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

export async function runSmokeTests(
  options: {
    webUrl?: string;
    workerHealthUrl?: string;
    checkBlockchain?: boolean;
    requireProductionServices?: boolean;
  } = {},
): Promise<{ allPassed: boolean; checks: SmokeCheck[] }> {
  const webUrl = options.webUrl || process.env["APP_URL"] || "http://localhost:3000";
  const workerHealthUrl =
    options.workerHealthUrl || process.env["WORKER_HEALTH_URL"] || "http://localhost:9090";

  const checks: SmokeCheck[] = [];

  // 1. Web server check
  const webStart = Date.now();
  try {
    const res = await fetch(webUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
    checks.push({
      name: "Web Application HTTP",
      passed: res.status < 400,
      durationMs: Date.now() - webStart,
      details: `HTTP ${res.status} ${res.statusText}`,
    });
  } catch (err) {
    checks.push({
      name: "Web Application HTTP",
      passed: false,
      durationMs: Date.now() - webStart,
      details: `Fetch error: ${String(err)}`,
    });
  }

  // 2. Worker liveness check
  const workerStart = Date.now();
  try {
    const res = await fetch(`${workerHealthUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { status?: string };
    const passed = res.status === 200 && body.status === "OK";
    checks.push({
      name: "Outbox Worker Health (/healthz)",
      passed,
      durationMs: Date.now() - workerStart,
      details: `HTTP ${res.status} [status: ${body.status ?? "UNKNOWN"}]`,
    });
  } catch (err) {
    checks.push({
      name: "Outbox Worker Health (/healthz)",
      passed: false,
      durationMs: Date.now() - workerStart,
      details: `Worker unreachable on ${workerHealthUrl}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 3. Worker readiness check
  const readyStart = Date.now();
  try {
    const res = await fetch(`${workerHealthUrl}/readyz`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as { status?: string };
    const passed = res.status === 200 && body.status === "READY";
    checks.push({
      name: "Outbox Worker Readiness (/readyz)",
      passed,
      durationMs: Date.now() - readyStart,
      details: `HTTP ${res.status} [status: ${body.status ?? "UNKNOWN"}]`,
    });
  } catch (err) {
    checks.push({
      name: "Outbox Worker Readiness (/readyz)",
      passed: false,
      durationMs: Date.now() - readyStart,
      details: `Worker readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 4. Database Public API / RPC Connectivity Check
  const dbUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const anonKey =
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_ANON_KEY"];

  if (!dbUrl || !anonKey) {
    if (options.requireProductionServices) {
      checks.push({
        name: "Database Configuration Presence",
        passed: false,
        durationMs: 0,
        details: "FAIL: SUPABASE_URL and SUPABASE_ANON_KEY are required for release validation.",
      });
    }
  } else {
    const dbStart = Date.now();
    try {
      const res = await fetch(`${dbUrl}/rest/v1/rpc/list_public_projects`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
      const passed = res.status === 200;
      checks.push({
        name: "Database RPC (list_public_projects)",
        passed,
        durationMs: Date.now() - dbStart,
        details: `HTTP ${res.status} ${res.statusText}`,
      });
    } catch (err) {
      checks.push({
        name: "Database RPC (list_public_projects)",
        passed: false,
        durationMs: Date.now() - dbStart,
        details: `Database request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 5. Blockchain RPC Connectivity, Chain ID & Contract Code Check
  const rpcUrl = process.env["BLOCKCHAIN_RPC_URL"];
  const contractAddress = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  const expectedChainId = process.env["BLOCKCHAIN_CHAIN_ID"];
  const shouldCheckBlockchain =
    options.checkBlockchain ?? options.requireProductionServices ?? Boolean(rpcUrl);

  if (shouldCheckBlockchain) {
    const bStart = Date.now();
    if (!rpcUrl) {
      checks.push({
        name: "Blockchain RPC Check",
        passed: false,
        durationMs: 0,
        details: "FAIL: BLOCKCHAIN_RPC_URL is missing in release validation mode",
      });
    } else {
      try {
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        });
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(5000),
        });
        const json = (await res.json()) as { result?: string; error?: { message: string } };
        const hasBlock = Boolean(json.result && json.result.startsWith("0x"));

        checks.push({
          name: "Blockchain RPC (eth_blockNumber)",
          passed: res.status === 200 && hasBlock,
          durationMs: Date.now() - bStart,
          details: hasBlock
            ? `Current block: ${parseInt(json.result!, 16)}`
            : `RPC Error: ${json.error?.message ?? "Invalid response"}`,
        });

        // 5a. Chain ID verification
        // 5a. Chain ID verification
        if (!expectedChainId && options.requireProductionServices) {
          checks.push({
            name: "Blockchain Chain ID Configuration",
            passed: false,
            durationMs: 0,
            details:
              "FAIL: BLOCKCHAIN_CHAIN_ID is required in release validation mode to prevent wrong network anchoring",
          });
        } else if (hasBlock) {
          const chainIdPayload = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_chainId",
            params: [],
            id: 2,
          });
          const chainRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: chainIdPayload,
            signal: AbortSignal.timeout(5000),
          });
          const chainJson = (await chainRes.json()) as { result?: string };
          const actualChainId = chainJson.result ? parseInt(chainJson.result, 16) : null;
          const chainMatch = expectedChainId
            ? actualChainId === parseInt(expectedChainId, 10)
            : true;

          checks.push({
            name: "Blockchain Chain ID (eth_chainId)",
            passed: chainRes.status === 200 && Boolean(actualChainId) && chainMatch,
            durationMs: Date.now() - bStart,
            details: actualChainId
              ? `Chain ID: ${actualChainId}${expectedChainId ? ` (expected ${expectedChainId}, match: ${chainMatch})` : ""}`
              : "Unable to retrieve eth_chainId",
          });
        }

        // 5b. Contract bytecode verification and read-only interface check
        if (!contractAddress && options.requireProductionServices) {
          checks.push({
            name: "Blockchain Contract Code Presence",
            passed: false,
            durationMs: 0,
            details: "FAIL: BLOCKCHAIN_CONTRACT_ADDRESS is missing in release validation mode",
          });
        } else if (contractAddress && hasBlock) {
          const cStart = Date.now();
          const codePayload = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getCode",
            params: [contractAddress, "latest"],
            id: 3,
          });
          const codeRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: codePayload,
            signal: AbortSignal.timeout(5000),
          });
          const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);
          const codeJson = (await codeRes.json()) as { result?: string };
          const bytecode = codeJson.result ?? "";
          const hasCode = bytecode.startsWith("0x") && bytecode.length > 100;

          // Check runtime bytecode hash if EXPECTED_CONTRACT_BYTECODE_HASH is specified
          const expectedBytecodeHash = process.env["EXPECTED_CONTRACT_BYTECODE_HASH"];
          let bytecodeHashMatch = true;
          if (expectedBytecodeHash && hasCode) {
            const actualBytecodeHash = ethers.keccak256(bytecode);
            bytecodeHashMatch =
              actualBytecodeHash.toLowerCase() === expectedBytecodeHash.toLowerCase();
          }

          checks.push({
            name: "Blockchain Contract Code (eth_getCode)",
            passed: codeRes.status === 200 && hasCode && bytecodeHashMatch,
            durationMs: Date.now() - cStart,
            details: hasCode
              ? bytecodeHashMatch
                ? `Contract bytecode verified at ${contractAddress} (bytes: ${(bytecode.length - 2) / 2})`
                : `Bytecode hash mismatch! Expected ${expectedBytecodeHash}, got ${ethers.keccak256(bytecode)}`
              : `No contract code deployed at ${contractAddress}`,
          });

          // 5c. Multi-method interface & identity validation
          if (hasCode) {
            const callStart = Date.now();
            try {
              // 1. CARBON_DECIMALS() call
              const decimalsPayload = JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [
                  { to: contractAddress, data: iface.encodeFunctionData("CARBON_DECIMALS") },
                  "latest",
                ],
                id: 4,
              });
              const decRes = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: decimalsPayload,
                signal: AbortSignal.timeout(5000),
              });
              const decJson = (await decRes.json()) as { result?: string };
              const decimals = decJson.result
                ? Number(iface.decodeFunctionResult("CARBON_DECIMALS", decJson.result)[0])
                : null;
              const isCorrectDecimals = decimals === 3;

              // 2. owner() call
              const ownerPayload = JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_call",
                params: [
                  { to: contractAddress, data: iface.encodeFunctionData("owner") },
                  "latest",
                ],
                id: 5,
              });
              const ownerRes = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: ownerPayload,
                signal: AbortSignal.timeout(5000),
              });
              const ownerJson = (await ownerRes.json()) as { result?: string };
              const ownerAddress = ownerJson.result
                ? String(iface.decodeFunctionResult("owner", ownerJson.result)[0])
                : null;
              const hasValidOwner =
                Boolean(ownerAddress) &&
                ethers.isAddress(ownerAddress) &&
                ownerAddress !== ethers.ZeroAddress;

              const isVerifiedIdentity = isCorrectDecimals && hasValidOwner;

              checks.push({
                name: "Blockchain Contract Interface & Identity Fingerprint",
                passed: isVerifiedIdentity,
                durationMs: Date.now() - callStart,
                details: isVerifiedIdentity
                  ? `Registry interface verified: CARBON_DECIMALS = 3, Owner = ${ownerAddress}`
                  : `Contract response mismatch: decimals = ${decimals}, owner = ${ownerAddress}`,
              });
            } catch (err) {
              checks.push({
                name: "Blockchain Contract Interface & Identity Fingerprint",
                passed: false,
                durationMs: Date.now() - callStart,
                details: `Contract eth_call error: ${String(err)}`,
              });
            }
          }
        }
      } catch (err) {
        checks.push({
          name: "Blockchain RPC Check",
          passed: false,
          durationMs: Date.now() - bStart,
          details: `RPC connection error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  const allPassed = checks.every((c) => c.passed);
  return { allPassed, checks };
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("smoke-test.ts")
) {
  // Strict mode is ENABLED by default; use --permissive or SMOKE_STRICT=false only for non-blocking local observation
  const isStrict =
    !process.argv.includes("--permissive") && process.env["SMOKE_STRICT"] !== "false";
  const isReleaseMode =
    process.argv.includes("--release") || process.env["RELEASE_MODE"] === "production";

  console.log(
    `=== Running Staging / Production Smoke Tests (Strict Mode: ${isStrict}, Release Mode: ${isReleaseMode}) ===`,
  );
  runSmokeTests({
    checkBlockchain:
      process.argv.includes("--blockchain") ||
      process.env["CHECK_BLOCKCHAIN"] === "true" ||
      isReleaseMode,
    requireProductionServices: isReleaseMode,
  }).then(({ allPassed, checks }) => {
    for (const c of checks) {
      console.log(
        `[${c.passed ? "PASS" : "FAIL"}] ${c.name} (${c.durationMs}ms): ${c.details ?? ""}`,
      );
    }
    console.log("================================================");
    console.log(allPassed ? "Smoke verification PASSED." : "Smoke verification FAILED.");
    if (isStrict && !allPassed) {
      process.exit(1);
    }
  });
}
