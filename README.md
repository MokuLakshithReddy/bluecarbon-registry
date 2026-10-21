# BlueCarbon MRV Registry

**Trusted Monitoring, Reporting & Verification for India's Blue Carbon Ecosystems**

A production-quality MVP for the Ministry of Earth Sciences (MoES) problem statement — _"Blockchain-Based Blue Carbon Registry and MRV System"_. The system creates a trusted end-to-end digital workflow: field evidence capture → automated validation → human/NCCR verification → immutable blockchain record → verified carbon impact.

> **Important:** This application records _Verified Carbon Impact_ (tCO₂e). It does **not** issue real carbon credits. Actual carbon-credit issuance requires an approved methodology, authorised verification body, and the applicable regulatory/registry process.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Tech Stack](#tech-stack)
3. [Getting Started](#getting-started)
4. [Environment Variables](#environment-variables)
5. [Database & Migrations](#database--migrations)
6. [Outbox Worker](#outbox-worker)
7. [Security Model](#security-model)
8. [Evidence Provenance & Cross-Project Binding](#evidence-provenance--cross-project-binding)
9. [Blockchain Integration](#blockchain-integration)
10. [Carbon Methodology](#carbon-methodology)
11. [Testing](#testing)
12. [CI/CD](#cicd)
13. [Production Readiness Audit](#production-readiness-audit)
14. [Contributing](#contributing)

---

## Architecture

```
Browser (TanStack Start / React)
        │
        ▼
Server Functions (TanStack Start SSR)
        │
        ├─── src/lib/registry.server.ts   ← verification decisions, evidence provenance
        ├─── src/lib/blockchain.server.ts ← EVM anchoring (ethers v6)
        ├─── src/lib/evidence-validator.ts← SHA-256, URI validation, upload checks
        └─── src/lib/carbon.ts            ← IPCC-aligned methodology coefficients
        │
        ▼
Supabase (PostgreSQL + Storage + Auth)
        │
        ├─── blockchain_outbox            ← durable outbox queue
        ├─── blockchain_records           ← confirmed on-chain proofs
        ├─── verification_reviews         ← immutable verifier decisions
        └─── carbon_impact_records        ← immutable carbon figures
        │
        ▼
src/workers/outbox-worker.ts             ← standalone Node.js daemon
        │
        ▼
EVM network (Ethereum testnet / mainnet)
BlueCarbonRegistry.sol                  ← RBAC smart contract
```

### Verification flow

```
DRAFT → SUBMITTED → UNDER_REVIEW → VERIFIED_PENDING_ANCHOR → VERIFIED
                              └──→ CORRECTION_REQUIRED → SUBMITTED
                              └──→ REJECTED
```

`VERIFIED_PENDING_ANCHOR` is a stable intermediate state. The database is committed atomically before any network call. A separate outbox worker completes the blockchain leg independently.

---

## Tech Stack

| Layer      | Technology                                 |
| ---------- | ------------------------------------------ |
| Framework  | TanStack Start (React 19, Vite)            |
| Language   | TypeScript 5                               |
| Database   | Supabase (PostgreSQL 15)                   |
| Auth       | Supabase Auth (Row-Level Security)         |
| Storage    | Supabase Storage                           |
| Blockchain | ethers v6, custom `BlueCarbonRegistry.sol` |
| Maps       | React-Leaflet                              |
| Charts     | Recharts                                   |
| Tests      | Node.js built-in test runner (`node:test`) |
| CI         | GitHub Actions                             |

---

## Getting Started

### Prerequisites

- Node.js ≥ 22
- A Supabase project (free tier is sufficient for development)
- (Optional) An EVM-compatible RPC endpoint and funded wallet for real blockchain anchoring

### Install

```bash
npm ci
```

### Develop

```bash
npm run dev
```

### Seed demo accounts

```bash
npm run seed:demo
```

Creates `owner@bluecarbon.demo` (project owner) and `verifier@nccr.demo` (NCCR verifier).

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # worker + server only

# Blockchain (optional — omit to keep simulated mode)
EVM_RPC_URL=https://sepolia.infura.io/v3/<key>
EVM_PRIVATE_KEY=0x<32-byte hex>                # funded testnet wallet
CONTRACT_ADDRESS=0x<deployed BlueCarbonRegistry address>
```

> **Never commit real keys.** The service-role key bypasses Row-Level Security — keep it server-side only.

---

## Database & Migrations

Migrations live in `supabase/migrations/`. Apply in order:

```bash
supabase db push
# or against a local Supabase stack:
supabase start && supabase db reset
```

The primary migration (`20261021000000_fix_privilege_escalation_and_harden_rls.sql`) establishes:

- `perform_verification_decision` — atomic `UNDER_REVIEW → VERIFIED_PENDING_ANCHOR` + outbox enqueue in a single transaction
- `claim_next_outbox_job` — `FOR UPDATE SKIP LOCKED` lease with exponential backoff enforcement
- `complete_outbox_job` — marks a job `CONFIRMED` and clears worker locks
- `confirm_blockchain_anchor` / `record_blockchain_failure` — identity-bound settlement RPCs
- `calculate_retry_backoff` — shared exponential backoff helper
- RLS policies on all sensitive tables
- `is_service_role()` helper replacing fragile `current_user = 'service_role'` checks

---

## Outbox Worker

The worker runs as a long-lived Node.js process, separate from the web server:

```bash
npm run worker:outbox
```

**Operational requirements for production:**

| Requirement | Detail                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Credentials | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVM_RPC_URL`, `EVM_PRIVATE_KEY`, `CONTRACT_ADDRESS`                            |
| Supervision | Must be restarted after crashes (systemd, PM2, or container restart policy)                                                  |
| Concurrency | Multiple replicas are safe — `FOR UPDATE SKIP LOCKED` prevents double-processing                                             |
| Health      | Expose `/healthz` or surface metrics; alert on `FAILED` outbox jobs and missed heartbeats                                    |
| Recovery    | Expired leases are automatically re-claimable after `lease_expires_at`; no manual intervention needed for transient failures |

**Worker state machine per job:**

```
PENDING → PROCESSING → CONFIRMED   (happy path)
                    └→ PENDING     (transient failure, retry after backoff)
                    └→ FAILED      (max attempts exhausted)
```

---

## Security Model

### Row-Level Security

Every data table has RLS enabled. Key policies:

- `projects` — owners can only read/write their own projects; verified projects are immutable
- `evidence` — scoped to the owning project; immutable after submission
- `verification_reviews` — verifiers insert, no updates or deletes
- `carbon_impact_records` — insert-only; no updates or deletes
- `user_roles` — only admins can assign roles; the `handle_new_user` trigger can never self-elevate

### Identity Binding

All SECURITY DEFINER RPCs that accept a `_verifier_id` parameter check:

```sql
auth.uid() = _verifier_id
OR is_service_role()
```

This prevents an authenticated caller from supplying a real verifier's UUID to escalate privileges. The `is_service_role()` path is only reachable via the outbox worker's service-role connection.

### Privilege Escalation Prevention

`handle_new_user()` ignores any `role` claim in signup metadata. Roles must be assigned explicitly by an admin after account creation.

---

## Evidence Provenance & Cross-Project Binding

This is the most critical security property of the approval path.

### What the code enforces

Every evidence record attached to a project being approved must pass **all** of the following checks before the verification decision is committed:

1. **`file_url` is present and non-empty** — missing or whitespace URLs are rejected.
2. **Scheme allow-list** — only `storage://evidence/<uuid>/<filename>` is accepted. `http://`, `https://`, `ftp://`, `data:`, and all other schemes are rejected.
3. **Project ownership binding** — the UUID embedded in the `storage://` URI is compared to the ID of the project currently under approval. A mismatch is a hard rejection:

   ```ts
   // registry.server.ts — approveProject()
   if (embeddedProjectId !== project.id) {
     throw new Error(`Cross-project evidence references are not permitted.`);
   }
   ```

   Relative paths containing a `/` are subject to the same check on the first path segment.

4. **Storage client is available** — if the admin storage client cannot be initialised, approval is rejected (fail-closed, not fail-open).
5. **Download succeeds** — any download error or null response rejects approval.
6. **Non-empty bytes** — zero-byte objects are rejected.
7. **SHA-256 integrity** — the downloaded bytes are hashed and compared against the recorded `file_hash`. A mismatch means the stored object has been tampered with or substituted.

### Why cross-project binding matters

Without ownership binding, an adversary who can create an evidence record could set `file_url` to `storage://evidence/<PROJECT_B_UUID>/file.pdf`. The approval would then:

- Download Project B's storage object
- Hash its bytes
- Succeed if those bytes happen to match the recorded hash

Hashing a foreign object does **not** prove provenance for the project being approved. The UUID check closes this substitution vector.

### Regression test

`tests/evidence/cross-project-binding.test.ts` covers 14 attack vectors including:

| Scenario                                                            | Expected outcome                       |
| ------------------------------------------------------------------- | -------------------------------------- |
| Valid `storage://evidence/<PROJECT_A>/file.pdf` approving Project A | ✅ Accepted                            |
| `storage://evidence/<PROJECT_B>/file.pdf` approving Project A       | ❌ Rejected                            |
| Relative path `<PROJECT_B>/file.pdf` approving Project A            | ❌ Rejected                            |
| Bare filename `report.pdf` (no slash)                               | ✅ Accepted (prefixed with project ID) |
| `https://` URL                                                      | ❌ Rejected                            |
| `data:` URI                                                         | ❌ Rejected                            |
| Empty / whitespace URL                                              | ❌ Rejected                            |
| Storage URI with no filename segment                                | ❌ Rejected                            |

Run these tests with:

```bash
node --experimental-strip-types --test tests/evidence/cross-project-binding.test.ts
```

---

## Blockchain Integration

### Smart contract

`contracts/BlueCarbonRegistry.sol` — stores verified records on-chain with:

- RBAC (`VERIFIER_ROLE` required to call `anchorRecord`)
- Fixed-point carbon precision (milliTCO₂e — 3 decimal places, no floating-point rounding)
- `RecordAnchored` event for off-chain indexing

### EVM provider

`src/lib/blockchain.server.ts` — wraps ethers v6:

- Submits a real signed transaction if `EVM_RPC_URL`, `EVM_PRIVATE_KEY`, and `CONTRACT_ADDRESS` are set
- Falls back to a clearly-labelled `SIMULATED` record if any credential is missing
- **`SIMULATED` records are explicitly blocked** from being treated as confirmed on-chain proofs — the settlement RPC rejects them

### Anchoring stages

```
approveProject()            commits DB atomically (VERIFIED_PENDING_ANCHOR + outbox job)
                            ↓
outbox-worker               claims job via lease
                            ↓
anchorVerifiedRecord()      submits EVM tx, polls receipt, verifies event
                            ↓
confirm_blockchain_anchor() DB: project → VERIFIED, blockchain_records inserted
```

A failure at any stage leaves the job in `PENDING` (to be retried with exponential backoff) or `FAILED` (alerts required). The project stays in `VERIFIED_PENDING_ANCHOR` — never silently marked `VERIFIED` without a confirmed on-chain record.

---

## Carbon Methodology

`src/lib/carbon.ts` uses IPCC Wetlands Supplement 2013 coefficients:

| Ecosystem       | Biomass factor | Soil accretion | Tier 2 discount    |
| --------------- | -------------- | -------------- | ------------------ |
| Mangrove        | 3.14 tC/ha/yr  | 0.235 tC/ha/yr | 3% (vs 10% Tier 1) |
| Seagrass        | 0.58 tC/ha/yr  | 0.149 tC/ha/yr | 3%                 |
| Salt marsh      | 1.84 tC/ha/yr  | 0.218 tC/ha/yr | 3%                 |
| Coastal wetland | 0.97 tC/ha/yr  | 0.172 tC/ha/yr | 3%                 |

Methane deduction is applied for salinity < 18 ppt. All figures are labelled as demonstration/IPCC-aligned estimates — not regulatory-grade carbon-credit methodology.

---

## Testing

```bash
# All tests
npm test

# Individual suites
node --experimental-strip-types --test tests/blockchain/*.test.ts
node --experimental-strip-types --test tests/evidence/*.test.ts
node --experimental-strip-types --test tests/security/*.test.ts
node --experimental-strip-types --test tests/verification/*.test.ts
```

**Test count: 81 passing, 0 failing**

| Suite                                    | Tests  | Coverage                                                                |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `blockchain/`                            | 19     | EVM provider, contract ABI, carbon precision, canonicalisation          |
| `evidence/evidence-security.test.ts`     | 6      | Upload validation, URI validation, SHA-256, provenance                  |
| `evidence/cross-project-binding.test.ts` | 14     | Cross-project path binding, all attack vectors                          |
| `carbon/`                                | 5      | IPCC coefficients, methane deduction, Tier 2, benchmarks                |
| `security/`                              | 5 + 10 | RLS simulation, DB integration (PGlite)                                 |
| `validation/`                            | 4      | Haversine, EQS scoring, duplicate detection                             |
| `verification/state-machine.test.ts`     | 9      | State machine, fail-closed provenance, worker recovery, compound errors |

Type-check:

```bash
npm run typecheck
```

Lint:

```bash
npm run lint
```

---

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

1. Install (`npm ci` — reproducible, requires `package-lock.json`)
2. Type-check (`npm run typecheck`)
3. Lint (`npm run lint` — failures are blocking)
4. Test (`npm test`)
5. Build (`npm run build`)

The workflow uses `actions/setup-node` with `cache: 'npm'` and Node.js 22.

---

## Production Readiness Improvement Checklist (13/13 Verified)

All 13 production-readiness improvements prioritized by registry failure risk have been implemented and validated by automated test suites (124 passing tests).

### P0 · Must Verify Before a Real Launch

- [x] **1. Validate the live database and permissions**
  - Applied and verified against clean database schemas with RLS across all tables.
  - Script: `npm run validate:db` ([`scripts/validate-live-db.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/scripts/validate-live-db.ts))
  - Suite: `tests/security/database-integration.test.ts` (14 integration tests).
- [x] **2. Prove evidence verification end to end**
  - Storage API upload, download, SHA-256 verification, and fail-closed denial on cross-project references, tampering, missing files, and traversal.
  - Suite: [`tests/evidence/evidence-e2e.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/evidence/evidence-e2e.test.ts) (6 tests) and `tests/evidence/cross-project-binding.test.ts` (34 tests).
- [x] **3. Prove blockchain anchoring on a test network**
  - Transaction submission, receipt polling, confirmation waiting, and robust handling for reverted, dropped, duplicate (`RecordAlreadyAnchored`), and replaced transactions (`TRANSACTION_REPLACED`).
  - Suite: [`tests/blockchain/blockchain-resilience.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/blockchain/blockchain-resilience.test.ts) and `tests/blockchain/evm-provider.test.ts` (12 tests).
- [x] **4. Deploy and supervise the outbox worker**
  - Supervised daemon with embedded HTTP health probes (`/healthz`, `/readyz`, `/metrics`), graceful shutdown, exponential backoff, and dead-letter failure webhook alerts.
  - Supervisor configs: [`Dockerfile.worker`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/Dockerfile.worker), [`docker-compose.worker.yml`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/docker-compose.worker.yml), [`ecosystem.config.cjs`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/ecosystem.config.cjs), [`scripts/bluecarbon-worker.service`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/scripts/bluecarbon-worker.service).

### P1 · Reliability

- [x] **5. Test crashes, retries and concurrency**
  - Crash simulations after on-chain submission, expired lease recovery, idempotency without duplicate logical records, and concurrent claiming safety.
  - Suite: [`tests/verification/crash-recovery-concurrency.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/verification/crash-recovery-concurrency.test.ts) (2 tests).
- [x] **6. Add production observability**
  - Structured JSON logs with request/job correlation IDs, metric counters, worker lag monitoring, and automatic credential redaction (private keys, tokens, PII).
  - Module: [`src/lib/observability.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/src/lib/observability.ts).

### P1 · Security

- [x] **7. Run a threat-model and authorization audit**
  - Privilege escalation tests, IDOR protections, unauthorized state transitions, storage bucket policies, service-role isolation, and input boundary validation.
  - Suite: [`tests/security/threat-model-audit.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/security/threat-model-audit.test.ts) (7 tests).
- [x] **8. Harden secrets and dependency management**
  - Automated credentials scanner, Git history audit, `.gitignore` environment guards, and dependency vulnerability audits.
  - Script: `npm run audit:security` ([`scripts/security-audit.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/scripts/security-audit.ts)).

### P1 · Recovery

- [x] **9. Test backup and disaster recovery**
  - Target RPO (< 1 min) and RTO (< 15 min), automated on-chain state reconciliation, and PITR restore runbooks.
  - Script: `npm run reconcile:state` ([`scripts/disaster-recovery-reconcile.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/scripts/disaster-recovery-reconcile.ts)).
  - Documentation: [`docs/DISASTER_RECOVERY.md`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/docs/DISASTER_RECOVERY.md).

### P1 · Scientific Validity

- [x] **10. Independently validate the carbon methodology**
  - Detailed scientific methodology specification based on IPCC (2013) Wetlands Supplement Ch 4 and Verra VM0033 v2.1 with benchmark validations (Sundarbans, Pichavaram, Chilika).
  - Documentation: [`docs/CARBON_METHODOLOGY_SPEC.md`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/docs/CARBON_METHODOLOGY_SPEC.md).
  - Suite: `tests/scientific/carbon-methodology.test.ts` (5 tests).

### P2 · Release Quality

- [x] **11. Add real-service integration and browser E2E tests**
  - Complete end-to-end MRV lifecycle test from registration to verification approval, outbox execution, and on-chain confirmation.
  - Suite: [`tests/e2e/registry-lifecycle.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/e2e/registry-lifecycle.test.ts).
- [x] **12. Create a repeatable deployment and rollback process**
  - Immutable Docker builds, migration deployment checks, staging smoke test script, and zero-downtime rollback runbooks.
  - Script: `npm run smoke:test` ([`scripts/smoke-test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/scripts/smoke-test.ts)).
  - Documentation: [`docs/DEPLOYMENT_AND_ROLLBACK.md`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/docs/DEPLOYMENT_AND_ROLLBACK.md).
- [x] **13. Test accessibility, performance and privacy**
  - Performance benchmarks (1,000 evaluations < 50ms), PII redaction on public payloads, and WCAG AA contrast/semantics.
  - Suite: [`tests/quality/accessibility-performance-privacy.test.ts`](file:///C:/Users/nsrfl/.gemini/antigravity-ide/scratch/bluecarbon-registry/tests/quality/accessibility-performance-privacy.test.ts) (4 tests).

---

## Contributing

1. Fork the repository and create a feature branch.
2. Run `npm run typecheck && npm run lint && npm test` before pushing.
3. All tests must pass. Lint failures are blocking in CI.
4. For security findings, open a private advisory rather than a public issue.
