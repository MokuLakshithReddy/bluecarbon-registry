# Deployment & Staging Network Runbook: BlueCarbon Registry

**Version:** 2.1  
**Target Networks:** Ethereum Sepolia Testnet (Chain ID: `11155111`), Polygon Amoy Testnet (Chain ID: `80002`)  
**Auditor Reference:** Item 3 (Distinguishing Local In-Process EVM Execution from Deployed-Chain Staging Transactions)

---

## 1. Architectural Distinction: Local EVM vs Wire Simulation vs Live Staging Testnet

To ensure zero ambiguity during security audits and compliance certification, this repository establishes a strict three-tier separation between in-process EVM simulation, local JSON-RPC wire simulation, and live staging testnet transactions:

| Dimension                | Tier 1: Local In-Process EVM (`npm run test:evm`) | Tier 2: Staging RPC-Wire Simulation (`npm run test:staging`) | Tier 3: Live Staging Testnet (`npm run test:staging:live`)                                                 |
| :----------------------- | :------------------------------------------------ | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| **Execution Engine**     | In-memory `@ethereumjs/vm` in Node.js process.    | Node.js HTTP JSON-RPC 2.0 wire node on `127.0.0.1`.          | External Ethereum Sepolia or Polygon Amoy validator node.                                                  |
| **Network & Transport**  | None. Direct in-process EVM opcode execution.     | HTTP JSON-RPC 2.0 wire serialization over localhost.         | Real Internet HTTPS JSON-RPC 2.0 wire protocol over WAN.                                                   |
| **State Persistence**    | Ephemeral (destroyed upon test exit).             | Ephemeral per-test run.                                      | **Persistent public testnet ledger** across all nodes.                                                     |
| **Transaction Receipts** | Synthetic in-memory result objects.               | Synthetic wire receipts conforming to EIP-155 / EIP-1559.    | **Real externally observable receipts** mined by network miners.                                           |
| **Gas & Mempool**        | Zero gas fees, immediate block execution.         | Simulated gas usage and priority fee calculations.           | **Real testnet gas consumption**, base fees, and priority tips.                                            |
| **Key & Safety Guard**   | Dummy in-memory testing key.                      | Hard-coded simulation dummy key (`0x0123...`).               | **Funded testnet private key from secret environment variable**. Built-in safety guard rejects dummy keys. |
| **CI / Automated Gate**  | Mandatory blocking check on every PR.             | Mandatory blocking check in CI without credentials.          | **Opt-in integration gate** enabled via `STAGING_RPC_URL` secrets.                                         |

> [!CAUTION]
> **Strict URL Hostname Loopback Safety Guard:**
> The hard-coded private key `0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` is strictly reserved for local RPC-wire simulation.
> The codebase enforces an automated runtime guard (`assertSafeStagingConfiguration` in `src/lib/blockchain.server.ts`):
>
> - Parses `cfg.rpcUrl` using `new URL()`.
> - Strictly verifies `isApprovedLoopbackHost(parsed.hostname)`, permitting only exact loopback hostnames (`localhost`, `127.0.0.1`, `::1`).
> - Rejects remote domains containing loopback strings in path, query string, fragments, or subdomains (e.g. `https://attacker.example/localhost`, `https://attacker.example?rpc=127.0.0.1`, `https://localhost.attacker.example`).
> - Any attempt to supply the simulation dummy key to a non-loopback endpoint immediately raises a fatal security exception (`SECURITY FATAL: The hard-coded simulation key (0x0123...) must NEVER be used on live networks`).

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

### Executing Opt-In Live Staging Integration & Capturing Receipts

When deploying to Ethereum Sepolia or Polygon Amoy, supply your funded credentials via environment secrets (never commit them):

```bash
STAGING_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY" \
STAGING_CONTRACT_ADDRESS="0xYourDeployedContractAddress" \
STAGING_PRIVATE_KEY="0xYourFundedKey" \
STAGING_CHAIN_ID=11155111 \
npm run test:staging
```

The test runner:

1. Validates chain ID, deployed bytecode length, and contract address format.
2. Anchors a unique timestamped staging record on-chain.
3. Awaits on-chain mining and verifies minimum block confirmation depth.
4. Outputs the canonical live receipt JSON:

```json
{
  "executed_at": "2026-10-26T11:30:00.000Z",
  "network": "Sepolia Testnet",
  "chain_id": 11155111,
  "contract_address": "0x...",
  "transaction_hash": "0x...",
  "block_number": 5890123,
  "confirmations": 2,
  "receipt_status": "SUCCESS",
  "explorer_url": "https://sepolia.etherscan.io/tx/0x...",
  "record_hash": "0x...",
  "project_code": "STAGING-TEST-..."
}
```

---

## 5. Durable Trust Registry Deployment & Production Onboarding

### Database Migration

The trust registry schema is defined in `supabase/migrations/20261026000000_durable_sensor_and_verifier_enrollment.sql`:

- `enrolled_sensor_devices`: Persistent hardware trust registry with calibration expiry and revocation tracking.
- `enrolled_verifiers`: Persistent auditor trust registry with accreditation expiry and authorized biomes.
- `enrollment_audit_log`: Immutable, append-only security log with database triggers rejecting all `UPDATE` and `DELETE` operations.

To apply and validate the migration against a deployed Supabase instance:

```bash
# Validate database health, RLS status, and trust registry tables
npm run validate:db
```

### Production Onboarding vs. Demonstration Fixtures

- Pre-seeded identities in the migration are provided for automated integration testing and local simulation.
- **Production Onboarding:** Physical sensors require manufacturer-certified public keys and calibration certificates. Accredited auditors require formal VVB accreditation IDs under ISO 14065 / Verra / NCCR MoES, enrolled exclusively via admin multi-sig or `service_role`.

---

## 6. Security & Multi-Sig Transition Plan

In production mainnet deployments:

1. **Gnosis Safe Multi-Sig:** `DEFAULT_ADMIN_ROLE` is transferred to a 3-of-5 multi-signature Safe requiring joint approval from accredited ecological registries and designated VVB auditors.
2. **48-Hour Timelock:** Role grants, verifier authorizations, and contract parameter modifications are queued via `scheduleAdminAction()` with a mandatory 48-hour delay.
3. **Hardware Enclaves:** In-situ telemetry gateways sign data payloads using tamper-proof hardware secure elements (HSM / Secure Element), preventing private key extraction.
