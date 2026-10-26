# Deployment & Staging Network Runbook: BlueCarbon Registry

**Version:** 2.1  
**Target Networks:** Ethereum Sepolia Testnet (Chain ID: `11155111`), Polygon Amoy Testnet (Chain ID: `80002`)  
**Auditor Reference:** Item 3 (Distinguishing Local In-Process EVM Execution from Deployed-Chain Staging Transactions)

---

## 1. Architectural Distinction: Local EVM vs Deployed Staging Chain

To ensure zero ambiguity during security audits and compliance certification, this repository establishes a strict separation between in-process EVM simulation and live staging network transactions:

| Dimension                  | Local In-Process EVM (`npm run test:evm`)                                  | Deployed Staging Network (`npm run test:staging`)                                                          |
| :------------------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| **Execution Engine**       | In-memory `@ethereumjs/vm` running inside the Node.js test process.        | Real EVM node communicating over HTTP JSON-RPC 2.0 wire protocol.                                          |
| **Network & Transport**    | None. Direct opcode interpretation without sockets or HTTP serialization.  | HTTP POST calls (`eth_sendRawTransaction`, `eth_getTransactionReceipt`, `eth_call`).                       |
| **State Persistence**      | Ephemeral. State ceases to exist when the Node.js test process terminates. | Persistent. State lives in the staging blockchain ledger across all nodes.                                 |
| **Transaction Receipts**   | Synthetic in-memory transaction result objects.                            | Externally observable receipts with block hash, block number, cumulative gas used, and logs bloom.         |
| **Mempool & Gas Dynamics** | Zero gas fees, instantaneous synthetic block creation.                     | Real base fees, priority tips, nonce management, and replacement transaction handling.                     |
| **Confirmation Depth**     | Immediate execution (1 synthetic block).                                   | Multi-block confirmation polling (minimum 2 blocks on staging, 12 on mainnet).                             |
| **Verification Purpose**   | Fast unit testing of Solidity bytecode logic and opcode correctness.       | Integration testing of wire protocol serialization, network resilience, receipt parsing, and RPC failover. |

---

## 2. Environment Configuration

### Required Environment Variables for Staging Anchoring

```bash
# Target Blockchain Network Name
BLOCKCHAIN_NETWORK="Sepolia Testnet"

# Network Chain ID (Mandatory for EIP-155 replay protection)
# 11155111 = Ethereum Sepolia | 80002 = Polygon Amoy
BLOCKCHAIN_CHAIN_ID=11155111

# Staging JSON-RPC 2.0 Provider Endpoint (Alchemy, Infura, QuickNode, or local staging node)
BLOCKCHAIN_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY"

# Deployed BlueCarbonRegistry Smart Contract Address
BLOCKCHAIN_CONTRACT_ADDRESS="0xYourDeployedContractAddressHere"

# Funded Deployer / Operator Private Key (Hex-encoded 64 characters with 0x prefix)
BLOCKCHAIN_PRIVATE_KEY="0xYourFundedStagingPrivateKeyHere"

# Block Explorer URL for deep-linking verified transaction receipts
BLOCKCHAIN_EXPLORER_URL="https://sepolia.etherscan.io"

# Minimum block confirmations required before marking record as CONFIRMED
BLOCKCHAIN_CONFIRMATIONS_REQUIRED=2
```

---

## 3. Contract Deployment Runbook

### Step 1: Pre-Flight Compilation & Bytecode Generation

Verify that the Solidity source compiles cleanly with zero warnings or errors:

```bash
npm run test:evm
```

### Step 2: Deploy to Staging Network

Using Hardhat, Foundry, or ethers.js script:

```typescript
import { ethers } from "ethers";
import solc from "solc";
import fs from "node:fs";

// 1. Compile contract
const source = fs.readFileSync("contracts/BlueCarbonRegistry.sol", "utf-8");
const input = {
  language: "Solidity",
  sources: { "BlueCarbonRegistry.sol": { content: source } },
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const contractArtifact = output.contracts["BlueCarbonRegistry.sol"]["BlueCarbonRegistry"];

// 2. Connect to staging RPC
const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);

// 3. Deploy contract factory
const factory = new ethers.ContractFactory(
  contractArtifact.abi,
  contractArtifact.evm.bytecode.object,
  wallet,
);
const contract = await factory.deploy();
await contract.waitForDeployment();

console.log("BlueCarbonRegistry deployed to:", await contract.getAddress());
```

### Step 3: Initialize Governance & Authorize Verifiers

1. **Verify Deployer Identity:** The deployer account holds the `DEFAULT_ADMIN_ROLE`.
2. **Authorize Accredited Verifiers:** Call `authorizeVerifier(verifierAddress)` for designated VVBs (e.g., NCCR audit keys).
3. **Verify Timelock State:** Ensure `timelockEnforced()` returns `true` (48-hour delay for critical administrative actions).

---

## 4. Staging Verification & Testing Protocol

### Executing Staging Wire Tests

Run the dedicated staging network integration test suite:

```bash
npm run test:staging
```

This test suite executes:

1. **Pre-Flight Network Identity Validation:** Connects to the RPC endpoint, calls `eth_chainId`, and asserts exact match against `BLOCKCHAIN_CHAIN_ID`.
2. **Bytecode Deployment Verification:** Queries `eth_getCode` at `BLOCKCHAIN_CONTRACT_ADDRESS` to confirm that compiled EVM bytecode is live on-chain.
3. **Signed Transaction Transmission:** Serializes real EIP-155 transactions, signs with the deployer key, and submits via `eth_sendRawTransaction`.
4. **Observable Receipt Validation:** Polls `eth_getTransactionReceipt`, asserting status `0x1`, gas consumption, block numbers, and decoded `RecordAnchored` events.
5. **On-Chain State Cross-Check:** Executes `verifyRecord()` view call via `eth_call` to confirm that the project code, fixed-point milli-tCO2e carbon balance, and timestamp match disk records byte-for-byte.
6. **Revert Handling:** Validates that transactions reverting on-chain fail closed and transition the database outbox to `FAILED` with descriptive on-chain error telemetry.

---

## 5. Security & Multi-Sig Transition Plan

In production mainnet deployments:

1. **Gnosis Safe Multi-Sig:** `DEFAULT_ADMIN_ROLE` is transferred to a 3-of-5 multi-signature Safe requiring joint approval from accredited ecological registries and designated VVB auditors.
2. **48-Hour Timelock:** Role grants, verifier authorizations, and contract parameter modifications are queued via `scheduleAdminAction()` with a mandatory 48-hour delay.
3. **Hardware Enclaves:** In-situ telemetry gateways sign data payloads using tamper-proof hardware secure elements (HSM / Secure Element), preventing private key extraction.
