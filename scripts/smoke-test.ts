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

  if (dbUrl && anonKey) {
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

  // 5. Blockchain RPC Connectivity & Contract Code Check (if configured)
  const rpcUrl = process.env["BLOCKCHAIN_RPC_URL"];
  const contractAddress = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  if (options.checkBlockchain ?? Boolean(rpcUrl)) {
    const bStart = Date.now();
    if (!rpcUrl) {
      checks.push({
        name: "Blockchain RPC Check",
        passed: false,
        durationMs: 0,
        details: "BLOCKCHAIN_RPC_URL environment variable is missing",
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

        if (contractAddress && hasBlock) {
          const cStart = Date.now();
          const codePayload = JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getCode",
            params: [contractAddress, "latest"],
            id: 2,
          });
          const codeRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: codePayload,
            signal: AbortSignal.timeout(5000),
          });
          const codeJson = (await codeRes.json()) as { result?: string };
          const hasCode =
            Boolean(codeJson.result) &&
            codeJson.result !== "0x" &&
            codeJson.result !== "0x0" &&
            codeJson.result!.length > 4;

          checks.push({
            name: "Blockchain Contract Code (eth_getCode)",
            passed: codeRes.status === 200 && hasCode,
            durationMs: Date.now() - cStart,
            details: hasCode
              ? `Contract bytecode present at ${contractAddress}`
              : `No contract code deployed at ${contractAddress}`,
          });
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
  console.log(`=== Running Staging / Production Smoke Tests (Strict Mode: ${isStrict}) ===`);
  runSmokeTests({
    checkBlockchain:
      process.argv.includes("--blockchain") || process.env["CHECK_BLOCKCHAIN"] === "true",
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
