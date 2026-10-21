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
  if (output.errors) {
    const fatalErrors = output.errors.filter((e: { severity: string }) => e.severity === "error");
    if (fatalErrors.length > 0) {
      throw new Error(`Solidity compilation failed: ${JSON.stringify(fatalErrors)}`);
    }
  }
  const contract = output.contracts["BlueCarbonRegistry.sol"]["BlueCarbonRegistry"];
  return {
    abi: contract.abi,
    bytecode: Buffer.from(contract.evm.bytecode.object, "hex"),
  };
}

test("P0 — Credit retirement is ownership-bound: one wallet cannot retire another wallet's credits", async () => {
  const { abi, bytecode } = compileContract();
  const vm = await createVM();
  const iface = new ethers.Interface(abi);

  const testBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });
  const deployerAddr = createAddressFromString("0x1111111111111111111111111111111111111111");
  const buyerAddr = createAddressFromString("0x2222222222222222222222222222222222222222");
  const unauthorizedAddr = createAddressFromString("0x3333333333333333333333333333333333333333");

  // Deploy contract
  const deployResult = await vm.evm.runCall({
    block: testBlock,
    caller: deployerAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });

  assert.strictEqual(deployResult.execResult.exceptionError, undefined, "Contract must deploy");
  const contractAddr = deployResult.createdAddress!;

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

  // 1. Mint credit batch with recipient set to deployer
  const mintData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    totalCarbonMilli,
    {
      projectCode: "BC-MNG-SUNDAR-01",
      vintageYear: 2026,
      ecosystem: "MANGROVE",
      methodology: "IPCC-WETLANDS-2013-VM0033",
      verificationBody: "NCCR-INDIA",
      recipient: "0x1111111111111111111111111111111111111111",
    },
  ]);

  const mintRes = await call(deployerAddr, mintData);
  assert.strictEqual(mintRes.exceptionError, undefined, "mintCreditBatch must execute cleanly");

  // 2. Query balances: deployer has 850,000 milli (85% circulating), buyer has 0
  const balDeployerData = iface.encodeFunctionData("balanceOf", [
    recordHash,
    "0x1111111111111111111111111111111111111111",
  ]);
  const balDeployerRes = await call(deployerAddr, balDeployerData);
  const balDeployer = iface.decodeFunctionResult("balanceOf", balDeployerRes.returnValue)[0];
  assert.strictEqual(balDeployer, 850_000n, "Deployer receives circulating credits");

  const balBuyerData = iface.encodeFunctionData("balanceOf", [
    recordHash,
    "0x2222222222222222222222222222222222222222",
  ]);
  const balBuyerRes = await call(deployerAddr, balBuyerData);
  const balBuyer = iface.decodeFunctionResult("balanceOf", balBuyerRes.returnValue)[0];
  assert.strictEqual(balBuyer, 0n, "Buyer initially holds 0 credits");

  // 3. P0 ENFORCEMENT: Unauthorized third-party caller attempts to retire credits without ownership
  const stealRetireData = iface.encodeFunctionData("retireCredits", [
    recordHash,
    100_000n,
    "Unauthorized Party",
    "Attempted credit theft",
  ]);
  const stealRes = await call(unauthorizedAddr, stealRetireData);
  assert.ok(
    stealRes.exceptionError,
    "Caller without balance must revert when attempting retirement",
  );

  // 4. Buyer attempts to retire before receiving any credits -> reverts
  const prematureRetireRes = await call(buyerAddr, stealRetireData);
  assert.ok(
    prematureRetireRes.exceptionError,
    "Buyer with 0 balance must revert on retirement attempt",
  );

  // 5. Deployer transfers 300,000 milli-tCO2e to Buyer
  const transferData = iface.encodeFunctionData("transferCredits", [
    recordHash,
    "0x2222222222222222222222222222222222222222",
    300_000n,
  ]);
  const transferRes = await call(deployerAddr, transferData);
  assert.strictEqual(transferRes.exceptionError, undefined, "Credit transfer must succeed");

  // Verify updated balances
  const updatedBuyerBalRes = await call(deployerAddr, balBuyerData);
  assert.strictEqual(
    iface.decodeFunctionResult("balanceOf", updatedBuyerBalRes.returnValue)[0],
    300_000n,
    "Buyer balance updated after transfer",
  );

  const updatedDeployerBalRes = await call(deployerAddr, balDeployerData);
  assert.strictEqual(
    iface.decodeFunctionResult("balanceOf", updatedDeployerBalRes.returnValue)[0],
    550_000n,
    "Deployer balance decremented after transfer",
  );

  // 6. Buyer attempts to retire MORE than their owned balance (e.g. 300,001) -> reverts
  const excessiveRetireData = iface.encodeFunctionData("retireCredits", [
    recordHash,
    300_001n,
    "Tata Steel Sustainability Initiative",
    "Scope 3 Freight Shipping Offset Q3 2026",
  ]);
  const excessiveRes = await call(buyerAddr, excessiveRetireData);
  assert.ok(excessiveRes.exceptionError, "Retirement exceeding caller's balance must revert");

  // 7. Buyer legitimately retires 200,000 milli-tCO2e from their owned balance
  const legitRetireData = iface.encodeFunctionData("retireCredits", [
    recordHash,
    200_000n,
    "Tata Steel Sustainability Initiative",
    "Scope 3 Freight Shipping Offset Q3 2026",
  ]);
  const legitRes = await call(buyerAddr, legitRetireData);
  assert.strictEqual(legitRes.exceptionError, undefined, "Legitimate retirement succeeds");

  const certificateId = iface.decodeFunctionResult("retireCredits", legitRes.returnValue)[0];
  assert.ok(certificateId && certificateId.startsWith("0x"), "Must generate unique Certificate ID");

  // 8. Verify buyer remaining balance is 100,000 and batch totals updated
  const finalBuyerBalRes = await call(deployerAddr, balBuyerData);
  assert.strictEqual(
    iface.decodeFunctionResult("balanceOf", finalBuyerBalRes.returnValue)[0],
    100_000n,
    "Buyer balance decremented by retired amount",
  );

  const getBatchData = iface.encodeFunctionData("getCreditBatch", [recordHash]);
  const batchRes = await call(deployerAddr, getBatchData);
  const decodedBatch = iface.decodeFunctionResult("getCreditBatch", batchRes.returnValue);
  assert.strictEqual(decodedBatch[6], 650_000n, "Batch circulatingMilli decreased to 650,000");
  assert.strictEqual(decodedBatch[8], 200_000n, "Batch retiredMilli increased to 200,000");
});

test("P1 — Credit batches can conflict with existing anchors: enforces consistency checks", async () => {
  const { abi, bytecode } = compileContract();
  const vm = await createVM();
  const iface = new ethers.Interface(abi);

  const testBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });
  const deployerAddr = createAddressFromString("0x1111111111111111111111111111111111111111");

  const deployResult = await vm.evm.runCall({
    block: testBlock,
    caller: deployerAddr,
    data: bytecode,
    gasLimit: 10_000_000n,
  });
  const contractAddr = deployResult.createdAddress!;

  async function call(caller: typeof deployerAddr, data: string) {
    const res = await vm.evm.runCall({
      block: testBlock,
      caller,
      to: contractAddr,
      data: Buffer.from(data.slice(2), "hex"),
      gasLimit: 3_000_000n,
    });
    return res.execResult;
  }

  const recordHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const verifiedCarbonMilli = 500_000n;

  // 1. Anchor canonical record first
  const anchorData = iface.encodeFunctionData("anchorRecord", [
    recordHash,
    "BC-SEAGRASS-CHILIKA-02",
    verifiedCarbonMilli,
  ]);
  const anchorRes = await call(deployerAddr, anchorData);
  assert.strictEqual(anchorRes.exceptionError, undefined, "anchorRecord must succeed");

  // 2. Reject zero quantity minting
  const zeroQuantityData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    0n,
    {
      projectCode: "BC-SEAGRASS-CHILIKA-02",
      vintageYear: 2026,
      ecosystem: "SEAGRASS",
      methodology: "VM0033",
      verificationBody: "NCCR-INDIA",
      recipient: "0x1111111111111111111111111111111111111111",
    },
  ]);
  const zeroRes = await call(deployerAddr, zeroQuantityData);
  assert.ok(zeroRes.exceptionError, "Zero quantity batch mint must revert");

  // 3. Reject batch with conflicting carbon quantity (e.g. 600,000 vs anchored 500,000)
  const mismatchQtyData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    600_000n,
    {
      projectCode: "BC-SEAGRASS-CHILIKA-02",
      vintageYear: 2026,
      ecosystem: "SEAGRASS",
      methodology: "VM0033",
      verificationBody: "NCCR-INDIA",
      recipient: "0x1111111111111111111111111111111111111111",
    },
  ]);
  const mismatchQtyRes = await call(deployerAddr, mismatchQtyData);
  assert.ok(
    mismatchQtyRes.exceptionError,
    "Conflicting quantity must revert (AnchorQuantityMismatch)",
  );

  // 4. Reject batch with conflicting project code
  const mismatchProjectData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    verifiedCarbonMilli,
    {
      projectCode: "CONFLICTING-PROJECT-CODE",
      vintageYear: 2026,
      ecosystem: "SEAGRASS",
      methodology: "VM0033",
      verificationBody: "NCCR-INDIA",
      recipient: "0x1111111111111111111111111111111111111111",
    },
  ]);
  const mismatchProjectRes = await call(deployerAddr, mismatchProjectData);
  assert.ok(
    mismatchProjectRes.exceptionError,
    "Conflicting project code must revert (AnchorProjectMismatch)",
  );

  // 5. Consistent batch mint succeeds
  const validBatchData = iface.encodeFunctionData("mintCreditBatch", [
    recordHash,
    verifiedCarbonMilli,
    {
      projectCode: "BC-SEAGRASS-CHILIKA-02",
      vintageYear: 2026,
      ecosystem: "SEAGRASS",
      methodology: "VM0033",
      verificationBody: "NCCR-INDIA",
      recipient: "0x1111111111111111111111111111111111111111",
    },
  ]);
  const validBatchRes = await call(deployerAddr, validBatchData);
  assert.strictEqual(validBatchRes.exceptionError, undefined, "Matching batch mint must succeed");
});

test("P1 — Bound timelock governs administrative actions: prevents bypass and binds queued actions", async () => {
  const { abi, bytecode } = compileContract();
  const vm = await createVM();
  const iface = new ethers.Interface(abi);

  const initialBlock = createBlock({ header: { timestamp: 1770000000n, number: 100n } });
  const adminAddr = createAddressFromString("0x1111111111111111111111111111111111111111");
  const targetVerifier = "0x4444444444444444444444444444444444444444";

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

  // 1. Turn ON timelock enforcement
  const setEnforcedData = iface.encodeFunctionData("setTimelockEnforcement", [true]);
  const setRes = await call(adminAddr, setEnforcedData);
  assert.strictEqual(setRes.exceptionError, undefined);

  // 2. Direct call to authorizeVerifier MUST FAIL when timelock is enforced
  const directAuthData = iface.encodeFunctionData("authorizeVerifier", [targetVerifier]);
  const directAuthRes = await call(adminAddr, directAuthData);
  assert.ok(
    directAuthRes.exceptionError,
    "Direct authorization must revert when timelock is enforced (TimelockEnforcedUseQueuedAction)",
  );

  // 3. Schedule bound admin action: AUTHORIZE_VERIFIER (enum 0)
  const emptyRole = ethers.ZeroHash;
  const scheduleActionData = iface.encodeFunctionData("scheduleAdminAction", [
    0, // AdminActionType.AUTHORIZE_VERIFIER
    targetVerifier,
    emptyRole,
  ]);
  const scheduleRes = await call(adminAddr, scheduleActionData, initialBlock);
  assert.strictEqual(scheduleRes.exceptionError, undefined, "Action scheduling must succeed");

  // 4. Immediate execution fails because 2-day timelock delay has not elapsed
  const executeActionData = iface.encodeFunctionData("executeAdminAction", [
    0, // AdminActionType.AUTHORIZE_VERIFIER
    targetVerifier,
    emptyRole,
  ]);
  const earlyExecRes = await call(adminAddr, executeActionData, initialBlock);
  assert.ok(earlyExecRes.exceptionError, "Early execution must revert (TimelockPending)");

  // 5. Fast forward block timestamp by 172,900 seconds (delay is 172,800)
  const laterBlock = createBlock({
    header: {
      timestamp: initialBlock.header.timestamp + 172_900n,
      number: initialBlock.header.number + 100n,
    },
  });

  // 6. Execute queued admin action after delay
  const validExecRes = await call(adminAddr, executeActionData, laterBlock);
  assert.strictEqual(validExecRes.exceptionError, undefined, "Execution must succeed after delay");

  // 7. Verify the verifier is now authorized
  const checkVerifierData = iface.encodeFunctionData("isAuthorizedVerifier", [targetVerifier]);
  const checkRes = await call(adminAddr, checkVerifierData, laterBlock);
  const isAuth = iface.decodeFunctionResult("isAuthorizedVerifier", checkRes.returnValue)[0];
  assert.strictEqual(isAuth, true, "Target verifier must now be authorized");

  // 8. Replay attack: executing the same action again must revert (TimelockAlreadyExecuted)
  const replayRes = await call(adminAddr, executeActionData, laterBlock);
  assert.ok(replayRes.exceptionError, "Action cannot be executed twice (TimelockAlreadyExecuted)");
});
