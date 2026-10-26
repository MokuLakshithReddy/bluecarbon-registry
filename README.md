# BlueCarbon Registry

[![CI Pipeline](https://github.com/MokuLakshithReddy/bluecarbon-registry/actions/workflows/ci.yml/badge.svg)](https://github.com/MokuLakshithReddy/bluecarbon-registry/actions/workflows/ci.yml)
[![Branch Protection](https://img.shields.io/badge/branch%20protection-main%20enforced-success)](https://github.com/MokuLakshithReddy/bluecarbon-registry/branches)
[![Tests Passing](https://img.shields.io/badge/tests-176%20passed-brightgreen)](tests)
![Node.js Version](https://img.shields.io/badge/node.js-%E2%89%A5%2022.0.0-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-v5.8-blue)
![Code Style](https://img.shields.io/badge/code%20style-prettier-ff69b4)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

> **Trusted Monitoring, Reporting & Verification (MRV) for India's Blue Carbon Ecosystems**
>
> A production-quality MVP aligned with the Ministry of Earth Sciences (MoES) problem statement — _"Blockchain-Based Blue Carbon Registry and MRV System"_. The system creates an end-to-end digital workflow: field evidence capture → automated validation → human/NCCR verifier review → immutable blockchain anchoring → verified carbon impact calculation.

---

> [!IMPORTANT]
> **Regulatory Disclaimer:** This application records _Verified Carbon Impact_ ($\text{tCO}_2\text{e}$) calculated via IPCC Wetlands Supplement defaults for demonstration and verification purposes. It does **not** issue real regulatory carbon credits. Actual carbon-credit issuance requires an approved methodology, an authorised verification body, and compliance with national/international registry frameworks.

---

## Table of Contents

- [Part 1: Product & Impact Overview](#part-1-product--impact-overview)
  - [Problem Statement](#problem-statement)
  - [Key Features & Capabilities](#key-features--capabilities)
  - [Verification & Anchoring Workflow](#verification--anchoring-workflow)
  - [Implemented vs. Demonstration Capabilities](#implemented-vs-demonstration-capabilities)
- [Part 2: Technical Architecture & Onboarding](#part-2-technical-architecture--onboarding)
  - [System Architecture](#system-architecture)
  - [Tech Stack](#tech-stack)
  - [Documentation Index](#documentation-index)
  - [Getting Started](#getting-started)
  - [Environment Variables](#environment-variables)
  - [Database & Migrations](#database--migrations)
  - [Outbox Worker Operations](#outbox-worker-operations)
  - [Security Model & Evidence Provenance](#security-model--evidence-provenance)
  - [Blockchain Integration](#blockchain-integration)
  - [Carbon Calculation Methodology](#carbon-calculation-methodology)
  - [Testing & Quality Gates](#testing--quality-gates)
  - [Production Readiness Audit & Remediations](#production-readiness-audit--remediations)
- [Contributing](#contributing)
- [License](#license)

---

# Part 1: Product & Impact Overview

## Problem Statement

India’s extensive coastal biomes—including mangroves, seagrasses, and salt marshes—sequester carbon at rates up to ten times higher than terrestrial forests. However, traditional coastal restoration and blue carbon tracking face critical bottlenecks:

- **Manual, Fragmented Verification:** Paper-based or uncoordinated evidence collection risks double-counting and data tampering.
- **Opacity & Fraud Risks:** Vulnerabilities in evidence provenance enable cross-project data reuse or altered spatial boundaries.
- **Lack of Immutable Audit Trails:** Stakeholders lack a single source of truth for verification decisions and carbon impact claims.

The **BlueCarbon Registry** solves these challenges by combining cryptographic evidence hashing, strict database Row-Level Security (RLS), IPCC-aligned science, and EVM smart contract anchoring into a transparent, audit-ready digital system.

---

## Key Features & Capabilities

- 🛡️ **Cryptographic Evidence Integrity:** SHA-256 evidence hashing and strict `storage://` URI scheme enforcement prevent cross-project evidence substitution and file tampering.
- 📐 **Spatial & Geospatial Validation:** Ray-casting polygon containment and Haversine distance calculations check project boundaries and detect territorial double-registration.
- 🔬 **IPCC-Aligned Carbon Engine:** Automated calculation of biomass and soil accretion sequestration using IPCC Wetlands Supplement 2013 coefficients, including methane deduction adjustments.
- 🏛️ **Role-Based Access Control (RBAC):** Strict separation of privileges between Project Owners, NCCR/Third-Party Verifiers, and Platform Admins enforced at both database and smart contract levels.
- ⛓️ **Transactional Blockchain Outbox:** Asynchronous, crash-resilient EVM anchoring powered by a `FOR UPDATE SKIP LOCKED` outbox queue pattern.
- 🌐 **Public Transparency Dashboard:** Open access to public project details and verified carbon figures without exposing restricted evidence or PII.

---

## Verification & Anchoring Workflow

```
[ DRAFT ]  ─────────► [ SUBMITTED ]  ─────────► [ UNDER_REVIEW ]
                             ▲                          │
                             │                          ▼
                    (Correction Req.)       [ VERIFIED_PENDING_ANCHOR ]
                             │                          │
                             └─────────── [ REJECTED ]  │  (Atomic DB Commit & Outbox Enqueue)
                                                        ▼
                                                 [ Outbox Worker ]
                                                        │  (EVM Transaction & Receipt Verification)
                                                        ▼
                                                  [ VERIFIED ] (Confirmed On-Chain)
```

1. **Submission:** Project owners upload baseline evidence and submit spatial boundaries.
2. **Automated Checks:** System validates evidence schema, SHA-256 hashes, geo-boundaries, and multispectral/EQS indicators.
3. **Verifier Review:** Authorized verifiers (e.g., NCCR) inspect evidence, verify cross-project binding, and issue approval or rejection decisions with recorded commentary.
4. **Atomic Settlement:** Verification updates project state to `VERIFIED_PENDING_ANCHOR` and enqueues a transactional outbox job in a single PostgreSQL transaction.
5. **Blockchain Anchoring:** The dedicated background worker claims the outbox job, submits a signed EVM transaction to the `BlueCarbonRegistry` contract, waits for receipt finality, and commits the `tx_hash` to transition the project to `VERIFIED`.

---

## Implemented vs. Demonstration Capabilities

To maintain full transparency, the matrix below details the operational status of each capability across the platform:

| Capability / Feature                          | Status          | Operational Details                                                                                                                             |
| :-------------------------------------------- | :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence SHA-256 & URI Binding**            | ✅ Implemented  | Fail-closed evidence validation and cross-project URI matching in `src/lib/registry.server.ts`.                                                 |
| **Database RLS & Identity RPCs**              | ✅ Implemented  | PostgreSQL Row-Level Security and `SECURITY DEFINER` procedures in Supabase migrations.                                                         |
| **IPCC Methodology Engine**                   | ✅ Implemented  | Tiered biomass & soil accretion formulas with 15% risk buffer, methane deductions, and empirical validation in `src/lib/carbon-methodology.ts`. |
| **Smart Contract (`BlueCarbonRegistry.sol`)** | ✅ Implemented  | RBAC-protected EVM anchoring contract with fixed-point milli$\text{tCO}_2\text{e}$ precision.                                                   |
| **In-Process EVM Execution Tests**            | ✅ Implemented  | Tested against `@ethereumjs/vm` in `tests/blockchain/contract-solidity.test.ts`.                                                                |
| **Real EVM Network Anchoring**                | ⚙️ Configurable | Submits signed EVM transactions when RPC node credentials are set; falls back to simulated mode when omitted.                                   |
| **SIWE (Sign-In With Ethereum)**              | ✅ Implemented  | EIP-4361 authentication with atomic database nonce persistence.                                                                                 |
| **IoT / Drone Telemetry ECDSA**               | 🧪 Unit-Tested  | Validated in unit test suite (`tests/evidence/telemetry-crypto.test.ts`).                                                                       |
| **Decentralized Storage (IPFS / Arweave)**    | 🧪 Unit-Tested  | Gateway resolution and multihash verification tested in `tests/evidence/decentralized-storage.test.ts`.                                         |
| **Demo Account Quick-Login**                  | 🔒 Gated        | Restricted strictly to non-production development environments via `VITE_ALLOW_DEMO_LOGIN`.                                                     |

---

# Part 2: Technical Architecture & Onboarding

## System Architecture

```
                               ┌─────────────────────────────────────────┐
                               │       Browser (React 19 / TanStack)     │
                               └────────────────────┬────────────────────┘
                                                    │
                                                    ▼
                               ┌─────────────────────────────────────────┐
                               │  Server Functions (TanStack Start SSR)   │
                               │  ├── src/lib/registry.server.ts        │
                               │  ├── src/lib/blockchain.server.ts      │
                               │  ├── src/lib/evidence-validator.ts     │
                               │  └── src/lib/carbon-methodology.ts     │
                               └────────────────────┬────────────────────┘
                                                    │
                                                    ▼
                               ┌─────────────────────────────────────────┐
                               │    Supabase (PostgreSQL 15 + RLS)       │
                               │  ├── blockchain_outbox                  │
                               │  ├── blockchain_records                 │
                               │  ├── verification_reviews               │
                               │  └── carbon_impact_records              │
                               └────────────────────┬────────────────────┘
                                                    │
                                                    ▼
┌──────────────────────────────────────┐     [ FOR UPDATE SKIP LOCKED ]
│ src/workers/outbox-worker.ts         │◄───────────────────┘
│ (Standalone Node.js Daemon Process)  │
└──────────────────┬───────────────────┘
                   │
                   ▼ (ethers v6 signed tx)
┌──────────────────────────────────────┐
│ EVM Blockchain Network / Testnet     │
│ BlueCarbonRegistry.sol Contract      │
└──────────────────────────────────────┘
```

---

## Tech Stack

| Layer                   | Technology                                      | Description                                                     |
| :---------------------- | :---------------------------------------------- | :-------------------------------------------------------------- |
| **Web Framework**       | TanStack Start (React 19, Vite 6)               | Full-stack SSR and route handling                               |
| **Language**            | TypeScript 5.8                                  | End-to-end static type safety                                   |
| **Database & Auth**     | Supabase (PostgreSQL 15, Auth, Storage)         | Relational database with Row-Level Security policies            |
| **Blockchain**          | Solidity `^0.8.20`, ethers v6, `@ethereumjs/vm` | EVM smart contract anchoring and in-process execution tests     |
| **UI Components**       | Tailwind CSS v4, Radix UI, Lucide Icons         | Responsive accessible interface design                          |
| **Geospatial & Charts** | Leaflet, React-Leaflet, Recharts                | Interactive map boundary plotting and analytics                 |
| **Test Runner**         | Node.js built-in test runner (`node:test`)      | Fast native test execution without external runners             |
| **CI / CD**             | GitHub Actions                                  | Automated linting, typechecking, security scanning, and testing |

---

## Documentation Index

Deep-dive architecture specifications, security reviews, and operational runbooks are maintained in the [`docs/`](./docs) directory:

- 📖 [**Carbon Methodology Specification**](./docs/CARBON_METHODOLOGY_SPEC.md) — IPCC Wetlands Supplement 2013 equations, biomass/soil factors, methane deduction rules, and Tier 1/2/3 evidence requirements.
- 🔬 [**Reference Research Project Case**](./docs/REFERENCE_RESEARCH_PROJECT_CASE.md) — End-to-end reproducible research case (Sundarbans Lothian Island) with raw observations, soil core assays, telemetry, and mathematical derivation.
- 🚀 [**Deployment and Rollback Protocol**](./docs/DEPLOYMENT_AND_ROLLBACK.md) — Production deployment instructions, environment readiness checks, migration procedures, and zero-downtime rollback runbooks.
- 🚑 [**Disaster Recovery Runbook**](./docs/DISASTER_RECOVERY.md) — Outbox worker recovery, stranded job reconciliation, state synchronization, and emergency blockchain reconciliation procedures.
- 📜 [**MRV Standards Alignment**](./docs/MRV_STANDARDS_ALIGNMENT.md) — Compliance alignment with Verra VM0033/VM0007, Plan Vivo, and ISO 14064-2 monitoring standards.
- 🛡️ [**Smart Contract Audit Report**](./docs/SMART_CONTRACT_AUDIT.md) — Security audit findings, threat modeling, RBAC verification, and gas optimization analysis for `BlueCarbonRegistry.sol`.

---

## Getting Started

### Prerequisites

- **Node.js**: $\ge 22.0.0$ (required for native test runner features and ESM compatibility)
- **npm**: $\ge 10.0.0$
- **Supabase Account**: A Supabase project (free tier is fully supported for local development)
- _(Optional)_ **EVM RPC Endpoint**: Funded wallet private key and RPC URL for live blockchain testnet anchoring.

### Installation

Clone the repository and install dependencies using reproducible lockfile installation:

```bash
git clone https://github.com/MokuLakshithReddy/bluecarbon-registry.git
cd bluecarbon-registry
npm ci
```

### Local Development Server

Start the Vite development server with SSR enabled:

```bash
npm run dev
```

The application will be accessible at `http://localhost:3000` (or the port indicated in your console output).

### Seed Demonstration Accounts

To provision test project owners and verifier roles in a local development database:

```bash
npm run seed:demo
```

This creates the default demo accounts:

- **Project Owner:** `owner@bluecarbon.demo`
- **NCCR Verifier:** `verifier@nccr.demo`

_(Note: Demo login features are strictly disabled when running in production modes)._

---

## Environment Variables

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Refer to `.env.example` for comprehensive inline documentation on each parameter:

```env
# ------------------------------------------------------------------------------
# Supabase Configuration
# ------------------------------------------------------------------------------
VITE_SUPABASE_PROJECT_ID="your-project-id"
VITE_SUPABASE_URL="https://your-project-id.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_your-key-here"

SUPABASE_PROJECT_ID="your-project-id"
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_your-key-here"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_your_key" # SERVER-SIDE ONLY

# ------------------------------------------------------------------------------
# Blockchain Anchoring (Optional — Leave blank to run in simulated mode)
# ------------------------------------------------------------------------------
BLOCKCHAIN_RPC_URL="https://polygon-amoy.g.alchemy.com/v2/your-api-key"
BLOCKCHAIN_PRIVATE_KEY="0x0000000000000000000000000000000000000000000000000000000000000000"
BLOCKCHAIN_CONTRACT_ADDRESS="0x0000000000000000000000000000000000000000"
BLOCKCHAIN_NETWORK="Polygon Amoy Testnet"
BLOCKCHAIN_EXPLORER_URL="https://amoy.polygonscan.com"
BLOCKCHAIN_CONFIRMATIONS_REQUIRED="2"

# ------------------------------------------------------------------------------
# Administrative & Seed Settings
# ------------------------------------------------------------------------------
ADMIN_SEED_SECRET="generate-a-strong-random-seed-secret"
ALLOW_DEMO_SEED="false"
```

> [!WARNING]
> **Security Notice:** The `SUPABASE_SERVICE_ROLE_KEY` bypasses PostgreSQL Row-Level Security. It must **never** be exposed in client-side bundles or public repositories.

---

## Database & Migrations

Database migrations reside in `supabase/migrations/` and enforce all relational schemas, triggers, and Row-Level Security policies.

### Applying Migrations

Using the Supabase CLI:

```bash
# Push migrations to a remote Supabase project
supabase db push

# Or reset a local Supabase stack
supabase start && supabase db reset
```

### Core Security & Transactional RPCs

- `perform_verification_decision`: Atomically updates state (`UNDER_REVIEW → VERIFIED_PENDING_ANCHOR`), logs verifier review, records carbon figures, and enqueues an outbox job within a single PostgreSQL transaction.
- `claim_next_outbox_job`: Claims PENDING outbox jobs using `FOR UPDATE SKIP LOCKED` with lease expiration and exponential backoff.
- `complete_outbox_job`: Restricted exclusively to `service_role`. Marks outbox jobs as `CONFIRMED` upon receiving verifiable on-chain proof.
- `is_service_role()`: Replaces fragile user string checks with explicit JWT role claim checks.

---

## Outbox Worker Operations

The transactional outbox worker process decoupled blockchain transactions from web HTTP requests:

```bash
npm run worker:outbox
```

### Worker Lifecycle State Machine

```
[ PENDING ] ───(Claim Lease)───► [ PROCESSING ] ───(Receipt Verified)───► [ CONFIRMED ]
                                        │
                                        ├───(Transient Error)───► [ PENDING ] (Backoff Delay)
                                        │
                                        └───(Max Retries Exceeded)───► [ FAILED ]
```

### Operational Guidance

- **Concurrency Safety:** Replicas can run concurrently without double-processing because jobs are locked using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- **Health Monitoring:** Exposes a loopback health endpoint (`127.0.0.1:9090/healthz`).
- **Failure Recovery:** Transient failures return jobs to `PENDING` with exponential backoff. For manual recovery of `FAILED` jobs, consult the [Disaster Recovery Runbook](./docs/DISASTER_RECOVERY.md).

---

## Security Model & Evidence Provenance

### Row-Level Security Policies

- **`projects`**: Project owners can read/write their own draft projects. Verified projects are immutable.
- **`evidence`**: Scoped strictly to the owning project; immutable after project submission.
- **`verification_reviews`**: Insert-only for authenticated verifiers; updates and deletes are prohibited.
- **`carbon_impact_records`**: Append-only ledger; updates and deletes are strictly disabled.

### Cryptographic Evidence & Cross-Project Binding

To prevent evidence substitution or cross-project reuse, `src/lib/registry.server.ts` enforces the following validation checks prior to committing approval:

1. **Scheme Validation:** Only `storage://evidence/<project-id>/<filename>` URIs are permitted. HTTP(S), FTP, and data URIs are rejected.
2. **Project ID Embedding Check:** The UUID embedded in the evidence URI must match the project ID undergoing approval.
3. **SHA-256 Byte Verification:** The object is retrieved from storage, hashed via SHA-256, and verified against the recorded file hash. Tampered objects trigger an immediate fail-closed rejection.

---

## Blockchain Integration

### Smart Contract (`BlueCarbonRegistry.sol`)

The registry smart contract provides an immutable on-chain audit anchor:

- **Precision:** Carbon values are stored in fixed-point milli$\text{tCO}_2\text{e}$ (3 decimal places) to eliminate floating-point rounding ambiguities.
- **Role-Based Governance:** Restricted functions require `VERIFIER_ROLE` or `DEFAULT_ADMIN_ROLE`.
- **Event Auditing:** Emits `RecordAnchored(bytes32 indexed recordHash, string projectCode, uint256 carbonMilliTCO2)` for indexed verification.

### Contract Execution Verification

Contract logic is tested directly against an in-process EVM instance (`@ethereumjs/vm`) without requiring external testnet connectivity:

```bash
npm run test:evm
```

---

## Carbon Calculation Methodology

Calculations in `src/lib/carbon-methodology.ts` implement the IPCC Wetlands Supplement 2013 (Chapter 4) and Verra VM0033 v2.1 tiered accounting framework:

$$\text{Gross Accumulation } (C_{\text{gross}}) = \text{Area (ha)} \times \text{Duration (yr)} \times \Big( (R_{\text{bio}} \times S_{\text{rate}}) + R_{\text{soil}} \Big)$$

$$\text{Net Carbon Metric } (C_{\text{net}}) = \Big[ (C_{\text{gross}} - D_{\text{CH}_4} - D_{\text{leakage}}) \times (1 - B_{\text{reversal}}) \times (1 - U_{\text{discount}}) \Big]$$

### Ecosystem Sequestration Rates ($t\text{CO}_2\text{e}/\text{ha}/\text{yr}$)

| Coastal Biome        | Biomass Growth ($R_{\text{bio}}$) | Soil Accretion ($R_{\text{soil}}$) | Gross Annual Rate ($C_{\text{gross}}$) | Baseline Buffer ($B_{\text{reversal}}$) |
| :------------------- | :-------------------------------- | :--------------------------------- | :------------------------------------- | :-------------------------------------- |
| **Mangrove Forest**  | $7.80$                            | $5.90$                             | $13.70$                                | $15\%$ (Verra AFOLU Risk Standard)      |
| **Seagrass Meadow**  | $0.40$                            | $4.80$                             | $5.20$                                 | $15\%$                                  |
| **Tidal Salt Marsh** | $2.10$                            | $6.20$                             | $8.30$                                 | $15\%$                                  |
| **Coastal Wetland**  | $3.20$                            | $4.50$                             | $7.70$                                 | $15\%$                                  |

- **Methane ($\text{CH}_4$) Adjustment:** For brackish or low-salinity sites ($< 18\text{ ppt}$), a methane deduction of $5.42\text{ tCO}_2\text{e/ha/yr}$ ($193.7\text{ kg CH}_4\text{/ha/yr} \times 28\text{ GWP-100}$) is applied.
- **Scientific Uncertainty Discount ($U_{\text{discount}}$):** Tier 1: $10\%$, Tier 2: $5\%$ (requires verified site sampling), Tier 3: $3\%$ (requires validated soil cores and allometric plots).
- **Independent Empirical Validation:** Validated against peer-reviewed coastal field observations (Sundarbans Ray et al. 2011, Pichavaram Kathiresan 2000, Chilika Ganguly et al. 2017) in `src/lib/empirical-validation-data.ts`.
- **Reproducible Case Study:** See [`docs/REFERENCE_RESEARCH_PROJECT_CASE.md`](./docs/REFERENCE_RESEARCH_PROJECT_CASE.md) for a complete step-by-step audit trail.

---

## Testing & Quality Gates

The repository contains an extensive automated test suite covering unit, integration, database, security, and smart contract execution logic.

### Test Execution Commands

```bash
# Run full automated test suite
npm test

# Run isolated test suites
node --experimental-strip-types --test tests/blockchain/*.test.ts
node --experimental-strip-types --test tests/evidence/*.test.ts
node --experimental-strip-types --test tests/security/*.test.ts
node --experimental-strip-types --test tests/verification/*.test.ts
node --experimental-strip-types --test tests/scientific/*.test.ts

# In-process EVM smart contract execution suite
npm run test:evm

# Static Typechecking
npm run typecheck

# ESLint Code Inspection
npm run lint

# Security Audit & Dependency Scanner
npm run audit:security
```

### Test Coverage Summary

> **Current Status:** **173 passing tests across 21 test suites** (0 failing).
>
> _Note on Metrics:_ This test count represents automated local and CI verification across all domain modules. It serves as a regression prevention suite and code quality gate rather than a third-party security certification.

| Test Suite Module                | Test Count | Key Areas Covered                                                                               |
| :------------------------------- | :--------: | :---------------------------------------------------------------------------------------------- |
| `tests/blockchain/`              |     28     | EVM provider, receipt verification, batch minting, buffer pool, retirement, timelock governance |
| `tests/deployment/`              |     4      | RPC failover, wrong chain ID handling, missing bytecode resilience, timeout handling            |
| `tests/evidence/`                |     50     | SHA-256 integrity, cross-project URI binding, IPFS/Arweave resolution, telemetry ECDSA          |
| `tests/scientific/`              |     9      | IPCC coefficients, methane adjustments, Tier 1/2/3 downgrades, date boundary logic              |
| `tests/security/`                |     32     | SIWE nonces, PGlite DB RLS, identity RPC checks, secret scanning, threat modeling, IDOR         |
| `tests/validation/`              |     12     | Geo boundary ray-casting, double-registration collisions, Haversine metrics, EQS scoring        |
| `tests/verification/`            |     18     | Workflow state machine, crash recovery, outbox concurrency safety, compound error handling      |
| `tests/compliance/` & `quality/` |     20     | KYC volume limits, WCAG AA contrast compliance, performance latency bounds ($< 50\text{ms}$)    |

---

## Production Readiness Audit & Remediations

During system hardening, 16 findings identified across security, database isolation, and operational workflow domains were remediated and verified:

1. **Demo Login Isolation:** Demo authentication controls gated strictly behind development-mode environment flags (`VITE_ALLOW_DEMO_LOGIN`).
2. **Community Signed URLs:** Bounded strictly to authorized post authors or verified approved community posts with short expiration windows (15 minutes).
3. **Fail-Closed Public Evidence:** Database RPCs and server queries default to hiding evidence unless explicitly marked `is_public === true`.
4. **Synthetic Hash Elimination:** Removed synthetic transaction hash generation; all confirmations require valid on-chain transaction receipts.
5. **Receipt Log Verification:** Outbox settlement verifies contract logs for matching `RecordAnchored` topics before confirming records.
6. **Worker Endpoint Hardening:** Bound health server to localhost loopback (`127.0.0.1`) and masked diagnostic errors in HTTP responses.
7. **Disaster Recovery Ordering:** Reconciles mined on-chain transactions prior to claiming expired leases to prevent race conditions.
8. **Live DB RLS Validation:** Added automated `scripts/validate-live-db.ts` to test unauthenticated access restrictions using anonymous keys.
9. **Methodology Standardization:** Unified risk buffer withholding to $15.0\%$ and methane deduction to $5.42\text{ tCO}_2\text{e/ha/yr}$.
10. **Resilience Smoke Testing:** Integrated RPC timeout and chain ID failure validation in `scripts/smoke-test.ts`.
11. **CI Security Scanner:** Added `npm run audit:security` and Gitleaks secret scanning as blocking gates in GitHub Actions.
12. **History-Aware Secret Audit:** Scanning configured across full Git commit history with canary test verification (`tests/security/secret-audit-canary.test.ts`).
13. **In-Process EVM Execution:** Implemented pure TypeScript EVM tests against compiled Solidity bytecode (`tests/blockchain/contract-solidity.test.ts`).
14. **Fail-Closed Live DB RPC Verification:** Database validation script enforces exact expected PostgreSQL error codes (`42501`, `P0001`, `PGRST301`).
15. **Outbox Completion Trust Boundary:** Restricted `complete_outbox_job` execution exclusively to PostgreSQL `service_role`.
16. **EVM Network Identity Enforcement:** Mandatory `BLOCKCHAIN_CHAIN_ID` checks against `eth_chainId` during RPC provider initialization.
17. **Ownership & Governance Invariant Hardening:** `transferOwnership` and `executeAdminAction(AdminActionType.TRANSFER_OWNERSHIP)` revoke previous-owner administrative and verifier permissions. Enforced timelock cannot be bypassed immediately; disabling it requires a scheduled 2-day queued action.
18. **Durable SIWE Nonce & KYC Limit Persistence:** Replaced process-local stores with PostgreSQL-backed persistence (`siwe_nonces` and `kyc_compliance_transactions`), providing atomic single-use nonce consumption and rolling 365-day cumulative volume enforcement across distributed worker instances.
19. **Unified EVM Identity & Contract Validation:** Standardized chain ID, bytecode deployment, and confirmation checks across transaction anchoring, public verification, and disaster recovery via `validateEVMNetworkAndContract`.
20. **Crash Recovery & Concurrency Verification:** Validated `FOR UPDATE SKIP LOCKED` mutually exclusive job claiming, post-mining crash self-healing, duplicate event deduplication, and nested compound error handling.
21. **Automated CI Release Gates & Branch Protection:** Configured multi-stage release gates and branch protection on `main` requiring passing unit, integration, EVM, security, and recovery drill checks.

---

## Contributing

1. Fork the repository and create a descriptive feature branch (`git checkout -b feature/mrv-enhancement`).
2. Verify that all code checks pass locally:
   ```bash
   npm run typecheck && npm run lint && npm test && npm run audit:security
   ```
3. Commit changes following conventional commit formats.
4. Open a Pull Request against `main`. All GitHub Actions CI checks must pass prior to review approval.

For sensitive security findings, please submit a private advisory rather than opening a public issue.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
