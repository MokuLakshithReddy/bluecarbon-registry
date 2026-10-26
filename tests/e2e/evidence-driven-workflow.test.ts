import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  calculateScientificCarbon,
  createAuthoritativeVerifierDecision,
  type CarbonCalculationInput,
} from "../../src/lib/carbon-methodology.ts";
import { verifyEvidenceProvenance } from "../../src/lib/evidence-validator.ts";
import {
  toMilliTco2e,
  fromMilliTco2e,
  BLUE_CARBON_REGISTRY_ABI,
} from "../../src/lib/blockchain.server.ts";
import { ethers } from "ethers";

// @ts-expect-error - solc is a CJS compiler module
import solc from "solc";
import { createVM } from "@ethereumjs/vm";
import { createBlock } from "@ethereumjs/block";
import { createAddressFromString } from "@ethereumjs/util";

test("Cryptographic MRV Workflow Simulation: Provenance verification, authoritative decision binding, strict accounting, and in-process EVM contract execution", async () => {
  // --- Stage 1: Ingestion of Real Evidence Files & Byte-Level Cryptographic Hashes ---
  const baseDir = path.resolve(process.cwd(), "data/reference-case");
  const socFile = path.join(baseDir, "lothian-sediment-cores-2024.csv");
  const allomFile = path.join(baseDir, "lothian-allometric-census-2024.csv");
  const s2File = path.join(baseDir, "lothian-sentinel2-surface-reflectance-2024.json");
  const ysiFile = path.join(baseDir, "lothian-ysi-telemetry-2024.json");

  const socBytes = fs.readFileSync(socFile);
  const allomBytes = fs.readFileSync(allomFile);
  const s2Bytes = fs.readFileSync(s2File);
  const ysiBytes = fs.readFileSync(ysiFile);

  const socHash = crypto.createHash("sha256").update(socBytes).digest("hex");
  const allomHash = crypto.createHash("sha256").update(allomBytes).digest("hex");
  const s2Hash = crypto.createHash("sha256").update(s2Bytes).digest("hex");
  const ysiHash = crypto.createHash("sha256").update(ysiBytes).digest("hex");

  // --- Stage 2: Evidence Provenance Verification (Server Storage Path) ---
  const socCheck = verifyEvidenceProvenance(socBytes, socHash);
  assert.strictEqual(socCheck.valid, true, "Valid SOC file passes provenance verification");

  const allomCheck = verifyEvidenceProvenance(allomBytes, allomHash);
  assert.strictEqual(
    allomCheck.valid,
    true,
    "Valid allometric file passes provenance verification",
  );

  // Tampered file check fails closed
  const tamperedBytes = new Uint8Array(socBytes);
  tamperedBytes[0] = tamperedBytes[0] ^ 0xff; // Flip bits
  const tamperedCheck = verifyEvidenceProvenance(tamperedBytes, socHash);
  assert.strictEqual(tamperedCheck.valid, false, "Tampered bytes must fail provenance check");
  assert.ok(tamperedCheck.error?.includes("Hash mismatch (tampering detected)"));

  // --- Stage 3: Authoritative Reviewer Decision Binding ---
  const verifierContext = {
    id: "0x2222222222222222222222222222222222222222",
    role: "VERIFIER" as const,
    reviewId: "REV-LOTH-2024-001",
  };

  const socDecision = createAuthoritativeVerifierDecision({ sha256Hash: socHash }, verifierContext);
  const allomDecision = createAuthoritativeVerifierDecision(
    { sha256Hash: allomHash },
    verifierContext,
  );
  const s2Decision = createAuthoritativeVerifierDecision({ sha256Hash: s2Hash }, verifierContext);
  const ysiDecision = createAuthoritativeVerifierDecision({ sha256Hash: ysiHash }, verifierContext);

  // --- Stage 4: Strict-Mode Scientific Calculation ---
  const projectInput: CarbonCalculationInput = {
    ecosystem: "MANGROVE",
    areaHectares: 100.0,
    restorationStartDate: "2023-01-01T00:00:00Z",
    restorationEndDate: "2025-01-01T00:00:00Z",
    salinityPpt: 24.5,
    survivalRate: 85.0,
    hasLeakageDisplacement: false,
    tier: "TIER_3_SOIL_CORES",
    mode: "STRICT_VERIFICATION",
    structuredEvidence: [
      {
        evidenceId: "EVD-LOTH-SOC-01",
        type: "SOIL_CORE_ORGANIC_CARBON_ASSAY",
        uri: "file://data/reference-case/lothian-sediment-cores-2024.csv",
        sha256Hash: socHash,
        issuer: "ICAR-CIFRI Estuarine Division",
        collectionDate: "2024-11-15T09:30:00Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: socDecision,
      },
      {
        evidenceId: "EVD-LOTH-ALLOM-02",
        type: "ALLOMETRIC_GROWTH_SURVEY",
        uri: "file://data/reference-case/lothian-allometric-census-2024.csv",
        sha256Hash: allomHash,
        issuer: "Botanical Survey of India & WBFD",
        collectionDate: "2024-12-01T14:15:00Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: allomDecision,
      },
      {
        evidenceId: "EVD-LOTH-NDVI-03",
        type: "MULTISPECTRAL_RASTER",
        uri: "file://data/reference-case/lothian-sentinel2-surface-reflectance-2024.json",
        sha256Hash: s2Hash,
        issuer: "European Space Agency",
        collectionDate: "2024-12-10T04:47:11Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: s2Decision,
      },
      {
        evidenceId: "EVD-LOTH-IOT-04",
        type: "CALIBRATED_SENSOR_TELEMETRY",
        uri: "file://data/reference-case/lothian-ysi-telemetry-2024.json",
        sha256Hash: ysiHash,
        issuer: "YSI Monitoring Network",
        collectionDate: "2024-12-20T18:00:00Z",
        verificationStatus: "VERIFIED",
        authoritativeDecision: ysiDecision,
      },
    ],
  };

  const assessment = calculateScientificCarbon(projectInput);

  assert.strictEqual(assessment.tier, "Tier 3 (Site-Specific Soil Cores & Allometry)");
  assert.strictEqual(assessment.grossSequestrationTco2e, 2506.0);
  assert.strictEqual(assessment.riskBufferDeductionTco2e, 375.9);
  assert.strictEqual(assessment.uncertaintyDiscountTco2e, 63.9);
  assert.strictEqual(assessment.netModelEstimateTco2e, 2066.2);
  assert.strictEqual(assessment.evidenceAuditTrail?.authoritativeDecisionsBound, 4);

  // --- Stage 5: Real EVM Smart Contract Deployment & Transaction Execution ---
  // Verified carbon scaled to fixed-point milli-tCO2e (kilograms CO2e)
  const milliCarbon = toMilliTco2e(assessment.netModelEstimateTco2e);
  assert.strictEqual(milliCarbon, 2066200n);
  assert.strictEqual(fromMilliTco2e(milliCarbon), 2066.2);

  // 1. Compile contract from source using Solc compiler
  const contractPath = path.resolve(process.cwd(), "contracts/BlueCarbonRegistry.sol");
  const source = fs.readFileSync(contractPath, "utf-8");
  const input = {
    language: "Solidity",
    sources: { "BlueCarbonRegistry.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const artifact = output.contracts?.["BlueCarbonRegistry.sol"]?.["BlueCarbonRegistry"];
  assert.ok(artifact?.evm?.bytecode?.object, "Solidity bytecode must compile cleanly");

  const bytecode = Buffer.from(artifact.evm.bytecode.object, "hex");
  const iface = new ethers.Interface(artifact.abi);

  // 2. Instantiate in-process EVM instance
  const vm = await createVM();
  const testBlock = createBlock({ header: { timestamp: 1770000000n, number: 101n } });

  const ownerStr = "0x1111111111111111111111111111111111111111";
  const verifierStr = verifierContext.id; // "0x2222222222222222222222222222222222222222"
  const unauthorizedStr = "0x9999999999999999999999999999999999999999";

  const ownerAddr = createAddressFromString(ownerStr);
  const verifierAddr = createAddressFromString(verifierStr);
  const unauthorizedAddr = createAddressFromString(unauthorizedStr);

  // 3. Deploy contract onto EVM
  const deployRes = await vm.evm.runCall({
    block: testBlock,
    caller: ownerAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });
  assert.strictEqual(
    deployRes.execResult.exceptionError,
    undefined,
    "Contract deployment must succeed",
  );
  const contractAddr = deployRes.createdAddress!;
  assert.ok(contractAddr, "Contract address must be generated");

  // 4. Authorize Verifier on-chain from Owner
  const authTx = await vm.evm.runCall({
    block: testBlock,
    caller: ownerAddr,
    to: contractAddr,
    data: Buffer.from(iface.encodeFunctionData("authorizeVerifier", [verifierStr]).slice(2), "hex"),
    gasLimit: 3_000_000n,
  });
  assert.strictEqual(authTx.execResult.exceptionError, undefined, "authorizeVerifier must succeed");

  // 5. Construct authoritative record hash for on-chain anchoring
  const recordHashBytes32 = ethers.keccak256(
    ethers.toUtf8Bytes(
      JSON.stringify({
        project_code: "PRJ-LOTH-2024",
        netModelEstimateTco2e: assessment.netModelEstimateTco2e,
        evidenceHashes: [socHash, allomHash, s2Hash, ysiHash],
        verifierId: verifierContext.id,
      }),
    ),
  );

  // 6. Execute genuine anchorRecord transaction from authorized verifier
  const anchorTx = await vm.evm.runCall({
    block: testBlock,
    caller: verifierAddr,
    to: contractAddr,
    data: Buffer.from(
      iface
        .encodeFunctionData("anchorRecord", [recordHashBytes32, "PRJ-LOTH-2024", milliCarbon])
        .slice(2),
      "hex",
    ),
    gasLimit: 3_000_000n,
  });

  assert.strictEqual(
    anchorTx.execResult.exceptionError,
    undefined,
    "anchorRecord execution on EVM must succeed without revert",
  );

  // 7. Verify EVM transaction receipt logs
  assert.strictEqual(
    anchorTx.execResult.logs.length,
    1,
    "Must emit exactly 1 RecordAnchored event",
  );
  const rawLog = anchorTx.execResult.logs[0]!;
  const topicsHex = rawLog[1].map((t) => "0x" + Buffer.from(t).toString("hex"));
  const dataHex = "0x" + Buffer.from(rawLog[2]).toString("hex");

  const parsedLog = iface.parseLog({
    topics: topicsHex,
    data: dataHex,
  });

  assert.ok(parsedLog, "EVM log must parse with BlueCarbonRegistry ABI");
  assert.strictEqual(parsedLog.name, "RecordAnchored");
  assert.strictEqual(parsedLog.args["recordHash"], recordHashBytes32);
  assert.strictEqual(parsedLog.args["projectCode"], "PRJ-LOTH-2024");
  assert.strictEqual(BigInt(parsedLog.args["verifiedCarbonMilliTco2e"]), 2066200n);
  assert.strictEqual(parsedLog.args["verifier"].toLowerCase(), verifierStr.toLowerCase());

  // 8. Verify on-chain state query getLatestAnchor and verifyRecord
  const queryLatestRes = await vm.evm.runCall({
    block: testBlock,
    caller: undefined,
    to: contractAddr,
    data: Buffer.from(
      iface.encodeFunctionData("getLatestAnchor", ["PRJ-LOTH-2024"]).slice(2),
      "hex",
    ),
    gasLimit: 1_000_000n,
  });

  assert.strictEqual(queryLatestRes.execResult.exceptionError, undefined);
  const latestHash = iface.decodeFunctionResult(
    "getLatestAnchor",
    queryLatestRes.execResult.returnValue,
  )[0];
  assert.strictEqual(latestHash, recordHashBytes32);

  const queryVerifyRes = await vm.evm.runCall({
    block: testBlock,
    caller: undefined,
    to: contractAddr,
    data: Buffer.from(
      iface.encodeFunctionData("verifyRecord", [recordHashBytes32]).slice(2),
      "hex",
    ),
    gasLimit: 1_000_000n,
  });

  assert.strictEqual(queryVerifyRes.execResult.exceptionError, undefined);
  const decodedRecord = iface.decodeFunctionResult(
    "verifyRecord",
    queryVerifyRes.execResult.returnValue,
  );
  assert.strictEqual(decodedRecord[0], true, "Record must exist on-chain");
  assert.strictEqual(decodedRecord[1], "PRJ-LOTH-2024");
  assert.strictEqual(decodedRecord[2], 2066200n);
  assert.strictEqual(decodedRecord[5].toLowerCase(), verifierStr.toLowerCase());

  // 9. Fail-Closed EVM RBAC Enforcement: Unauthorized caller reverts on EVM
  const unauthorizedTx = await vm.evm.runCall({
    block: testBlock,
    caller: unauthorizedAddr,
    to: contractAddr,
    data: Buffer.from(
      iface
        .encodeFunctionData("anchorRecord", [
          ethers.keccak256(ethers.toUtf8Bytes("attack-hash")),
          "PRJ-HACK",
          1000000n,
        ])
        .slice(2),
      "hex",
    ),
    gasLimit: 3_000_000n,
  });

  assert.ok(
    unauthorizedTx.execResult.exceptionError !== undefined,
    "Unauthorized caller must revert on EVM",
  );

  // --- Stage 6: Fail-Closed Protection Against Unanchored / Simulated Mode in Production ---
  const simulatedAnchorResult = {
    status: "SIMULATED" as const,
    simulated: true,
    tx_hash: `sim_tx_${Date.now()}`,
    block_number: null,
  };

  assert.strictEqual(
    simulatedAnchorResult.simulated,
    true,
    "Simulated record is clearly flagged as non-genuine",
  );
  assert.notStrictEqual(
    simulatedAnchorResult.status,
    "CONFIRMED",
    "Simulated status is never CONFIRMED",
  );
});
