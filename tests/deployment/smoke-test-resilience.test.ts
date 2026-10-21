import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { ethers } from "ethers";
import { runSmokeTests } from "../../scripts/smoke-test.ts";
import { BLUE_CARBON_REGISTRY_ABI } from "../../src/lib/blockchain.server.ts";

const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);

function createMockRpcServer(handler: (method: string, params: unknown[]) => unknown) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const result = handler(payload.method, payload.params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: String(err) } }));
      }
    });
  });

  return new Promise<{ server: http.Server; url: string; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        resolve({
          server,
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    },
  );
}

test("Smoke Test: Fails when actual chain ID does not match expected chain ID", async () => {
  const mockRpc = await createMockRpcServer((method) => {
    if (method === "eth_blockNumber") return "0x100";
    if (method === "eth_chainId") return "0x1"; // Ethereum Mainnet (1)
    return null;
  });

  const prevRpc = process.env["BLOCKCHAIN_RPC_URL"];
  const prevChain = process.env["BLOCKCHAIN_CHAIN_ID"];
  try {
    process.env["BLOCKCHAIN_RPC_URL"] = mockRpc.url;
    process.env["BLOCKCHAIN_CHAIN_ID"] = "137"; // Expected Polygon (137)

    const result = await runSmokeTests({
      webUrl: "http://127.0.0.1:9", // Will fail web check, but let's test blockchain checks
      checkBlockchain: true,
      requireProductionServices: true,
    });

    const chainCheck = result.checks.find((c) => c.name.includes("eth_chainId"));
    assert.ok(chainCheck != null, "Chain ID check must run");
    assert.strictEqual(chainCheck.passed, false, "Wrong chain ID must fail smoke test");
  } finally {
    process.env["BLOCKCHAIN_RPC_URL"] = prevRpc;
    process.env["BLOCKCHAIN_CHAIN_ID"] = prevChain;
    await mockRpc.close();
  }
});

test("Smoke Test: Fails when contract address has no deployed bytecode", async () => {
  const mockRpc = await createMockRpcServer((method) => {
    if (method === "eth_blockNumber") return "0x100";
    if (method === "eth_chainId") return "0x89"; // 137
    if (method === "eth_getCode") return "0x"; // Empty / no bytecode
    return null;
  });

  const prevRpc = process.env["BLOCKCHAIN_RPC_URL"];
  const prevChain = process.env["BLOCKCHAIN_CHAIN_ID"];
  const prevContract = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  try {
    process.env["BLOCKCHAIN_RPC_URL"] = mockRpc.url;
    process.env["BLOCKCHAIN_CHAIN_ID"] = "137";
    process.env["BLOCKCHAIN_CONTRACT_ADDRESS"] = "0x1111111111111111111111111111111111111111";

    const result = await runSmokeTests({
      checkBlockchain: true,
      requireProductionServices: true,
    });

    const codeCheck = result.checks.find((c) => c.name.includes("eth_getCode"));
    assert.ok(codeCheck != null, "Bytecode check must run");
    assert.strictEqual(codeCheck.passed, false, "Empty bytecode must fail smoke test");
  } finally {
    process.env["BLOCKCHAIN_RPC_URL"] = prevRpc;
    process.env["BLOCKCHAIN_CHAIN_ID"] = prevChain;
    process.env["BLOCKCHAIN_CONTRACT_ADDRESS"] = prevContract;
    await mockRpc.close();
  }
});

test("Smoke Test: Fails when contract interface response is invalid or unexpected", async () => {
  const mockRpc = await createMockRpcServer((method) => {
    if (method === "eth_blockNumber") return "0x100";
    if (method === "eth_chainId") return "0x89"; // 137
    if (method === "eth_getCode") return "0x6080604052348015600f57600080fd5b5060" + "0".repeat(200);
    if (method === "eth_call") {
      // Return wrong decimal value (e.g. 18 instead of 3)
      return iface.encodeFunctionResult("CARBON_DECIMALS", [18]);
    }
    return null;
  });

  const prevRpc = process.env["BLOCKCHAIN_RPC_URL"];
  const prevChain = process.env["BLOCKCHAIN_CHAIN_ID"];
  const prevContract = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  try {
    process.env["BLOCKCHAIN_RPC_URL"] = mockRpc.url;
    process.env["BLOCKCHAIN_CHAIN_ID"] = "137";
    process.env["BLOCKCHAIN_CONTRACT_ADDRESS"] = "0x1111111111111111111111111111111111111111";

    const result = await runSmokeTests({
      checkBlockchain: true,
      requireProductionServices: true,
    });

    const ifaceCheck = result.checks.find((c) => c.name.includes("Identity Fingerprint"));
    assert.ok(ifaceCheck != null, "Interface check must run");
    assert.strictEqual(ifaceCheck.passed, false, "Wrong contract response must fail smoke test");
  } finally {
    process.env["BLOCKCHAIN_RPC_URL"] = prevRpc;
    process.env["BLOCKCHAIN_CHAIN_ID"] = prevChain;
    process.env["BLOCKCHAIN_CONTRACT_ADDRESS"] = prevContract;
    await mockRpc.close();
  }
});

test("Smoke Test: Fails when RPC server is unavailable or connection times out", async () => {
  const prevRpc = process.env["BLOCKCHAIN_RPC_URL"];
  try {
    // Unreachable non-routable test port
    process.env["BLOCKCHAIN_RPC_URL"] = "http://127.0.0.1:54321";

    const result = await runSmokeTests({
      checkBlockchain: true,
      requireProductionServices: true,
    });

    const rpcCheck = result.checks.find((c) => c.name.includes("Blockchain RPC Check"));
    assert.ok(rpcCheck != null);
    assert.strictEqual(rpcCheck.passed, false, "Unavailable RPC must fail smoke test");
  } finally {
    process.env["BLOCKCHAIN_RPC_URL"] = prevRpc;
  }
});
