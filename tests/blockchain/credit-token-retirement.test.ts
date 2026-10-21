import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
// @ts-expect-error - solc is a CJS compiler module
import solc from "solc";
import { createVM } from "@ethereumjs/vm";
import { createBlock } from "@ethereumjs/block";
import { createAddressFromString } from "@ethereumjs/util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTRACT_SOURCE_PATH = path.resolve(__dirname, "../../contracts/BlueCarbonRegistry.sol");

function compileContract() {
  const source = fs.readFileSync(CONTRACT_SOURCE_PATH, "utf-8");
  const input = {
    language: "Solidity",
    sources: { "BlueCarbonRegistry.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = output.contracts["BlueCarbonRegistry.sol"]["BlueCarbonRegistry"];
  return {
    abi: contract.abi,
    bytecode: Buffer.from(contract.evm.bytecode.object, "hex"),
  };
}

test("Credit Token & Retirement: Mints credit batch, enforces 15% buffer pool, and allows irreversible retirement", async () => {
  const { abi, bytecode } = compileContract();
  const vm = await createVM();
  const iface = new ethers.Interface(abi);

  const testBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });
  const deployerAddr = createAddressFromString("0x1111111111111111111111111111111111111111");
  const buyerAddr = createAddressFromString("0x2222222222222222222222222222222222222222");

  // Deploy contract
  const deployResult = await vm.evm.runCall({
    block: testBlock,
    caller: deployerAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });

  assert.strictEqual(deployResult.execResult.exceptionError, undefined, "Contract must deploy");
  const contractAddr = deployResult.createdAddress!;
  assert.ok(contractAddr, "Created contract address must exist");

  async function call(caller: typeof deployerAddr, data: string, block = testBlock) {
    const res = await vm.evm.runCall({
      block,
      caller,
      to: contractAddr,
      data: Buffer.from(data.slice(2), "hex"),
      gasLimit: 3_000_000n,
    });
    return res.execResult;
  }

  const recordHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const totalCarbonMilli = 1_000_000n; // 1,000 tCO2e = 1,000,000 milli-tCO2e

  // 1. Mint credit batch
  const mintData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    totalCarbonMilli,
    {
      projectCode: "BC-MNG-SUNDAR-01",
      vintageYear: 2026,
      ecosystem: "MANGROVE",
      methodology: "IPCC-WETLANDS-2013-VM0033",
      verificationBody: "NCCR-INDIA",
    },
  ]);

  const mintRes = await call(deployerAddr, mintData);
  assert.strictEqual(mintRes.exceptionError, undefined, "mintCreditBatch must execute cleanly");

  // 2. Query credit batch to verify 15% buffer pool deduction
  const getBatchData = iface.encodeFunctionData("getCreditBatch", [recordHash]);
  const batchRes = await call(deployerAddr, getBatchData);
  const decodedBatch = iface.decodeFunctionResult("getCreditBatch", batchRes.returnValue);

  assert.strictEqual(decodedBatch[0], "BC-MNG-SUNDAR-01");
  assert.strictEqual(decodedBatch[1], 2026n);
  assert.strictEqual(decodedBatch[5], totalCarbonMilli); // totalMintedMilli: 1,000,000
  assert.strictEqual(decodedBatch[6], 850_000n); // circulatingMilli: 850,000 (85%)
  assert.strictEqual(decodedBatch[7], 150_000n); // bufferPoolMilli: 150,000 (15% locked)
  assert.strictEqual(decodedBatch[8], 0n); // retiredMilli: 0

  // 3. Retire 200 tCO2e (200,000 milli) on behalf of corporate buyer
  const retireAmount = 200_000n;
  const retireData = iface.encodeFunctionData("retireCredits", [
    recordHash,
    retireAmount,
    "Tata Steel Sustainability Initiative",
    "Scope 3 Freight Shipping Offset Q3 2026",
  ]);

  const retireRes = await call(buyerAddr, retireData);
  assert.strictEqual(
    retireRes.exceptionError,
    undefined,
    "retireCredits must execute successfully",
  );

  const certificateId = iface.decodeFunctionResult("retireCredits", retireRes.returnValue)[0];
  assert.ok(certificateId && certificateId.startsWith("0x"), "Must generate unique Certificate ID");

  // 4. Verify batch balances updated: circulating reduced to 650,000, retired is 200,000
  const postRetireRes = await call(deployerAddr, getBatchData);
  const updatedBatch = iface.decodeFunctionResult("getCreditBatch", postRetireRes.returnValue);
  assert.strictEqual(updatedBatch[6], 650_000n, "Circulating must be decremented");
  assert.strictEqual(updatedBatch[8], 200_000n, "Retired must be incremented");

  // 5. Query Certificate details on-chain
  const certQueryData = iface.encodeFunctionData("getRetirementCertificate", [certificateId]);
  const certRes = await call(deployerAddr, certQueryData);
  const decodedCert = iface.decodeFunctionResult("getRetirementCertificate", certRes.returnValue);

  assert.strictEqual(decodedCert[0], recordHash);
  assert.strictEqual(decodedCert[2], "Tata Steel Sustainability Initiative");
  assert.strictEqual(decodedCert[3], "Scope 3 Freight Shipping Offset Q3 2026");
  assert.strictEqual(decodedCert[4], retireAmount);

  // 6. Fail-closed: Attempting to retire MORE than available circulating (e.g. 700,000 when only 650,000 remains)
  const excessiveRetireData = iface.encodeFunctionData("retireCredits", [
    recordHash,
    700_000n,
    "Failed Over-Retirement",
    "Exceeding balance",
  ]);
  const overRetireRes = await call(buyerAddr, excessiveRetireData);
  assert.ok(
    overRetireRes.exceptionError,
    "Over-retirement must revert on-chain (InsufficientBalance)",
  );
});

test("Credit Token & Governance: Timelock action scheduling and execution", async () => {
  const { abi, bytecode } = compileContract();
  const vm = await createVM();
  const iface = new ethers.Interface(abi);

  const initialBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });
  const adminAddr = createAddressFromString("0x1111111111111111111111111111111111111111");

  const deployResult = await vm.evm.runCall({
    block: initialBlock,
    caller: adminAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });
  const contractAddr = deployResult.createdAddress!;

  async function call(caller: typeof adminAddr, data: string, block = initialBlock) {
    const res = await vm.evm.runCall({
      block,
      caller,
      to: contractAddr,
      data: Buffer.from(data.slice(2), "hex"),
      gasLimit: 3_000_000n,
    });
    return res.execResult;
  }

  const actionHash = ethers.keccak256(
    ethers.toUtf8Bytes("UPDATE_ORACLE_ADDRESS_TO_CHAINLINK_0x123"),
  );

  // 1. Schedule timelock
  const scheduleData = iface.encodeFunctionData("scheduleTimelock", [actionHash]);
  const scheduleRes = await call(adminAddr, scheduleData, initialBlock);
  assert.strictEqual(scheduleRes.exceptionError, undefined);

  // 2. Immediate execution should fail because timelock is pending (2 days)
  const executeData = iface.encodeFunctionData("executeTimelock", [actionHash]);
  const earlyExecRes = await call(adminAddr, executeData, initialBlock);
  assert.ok(earlyExecRes.exceptionError, "Timelock must revert if executed before delay");

  // 3. Fast-forward block timestamp past 2 days (172,800 seconds)
  const laterBlock = createBlock({
    header: {
      timestamp: initialBlock.header.timestamp + 172_900n,
      number: initialBlock.header.number + 100n,
    },
  });

  // 4. Execution after timelock delay passes
  const validExecRes = await call(adminAddr, executeData, laterBlock);
  assert.strictEqual(
    validExecRes.exceptionError,
    undefined,
    "Timelock executes after delay has elapsed",
  );
});
