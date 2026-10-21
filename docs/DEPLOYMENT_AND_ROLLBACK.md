# Repeatable Deployment, Rollback & Release Runbook

**Registry System:** BlueCarbon MRV Registry  
**Audit Reference:** P2 — Create a repeatable deployment and rollback process

---

## 1. Release Architecture Overview

The system consists of two independent deployable units:

1. **Web / Server Function Application**: TanStack Start / Nitro application (Stateless, auto-scalable).
2. **Dedicated Outbox Queue Worker**: Supervised Node.js daemon (Stateful queue consumer, scales horizontally with `FOR UPDATE SKIP LOCKED`).

```
GitHub Repository (main)
        │
        ▼ (GitHub Actions CI/CD)
 ┌──────────────────────┐
 │  npm run lint        │
 │  npm run typecheck   │
 │  npm test            │
 │  npm run build       │
 └──────────────────────┘
        │
        ├─────────────────────────────┐
        ▼                             ▼
Web Deploy (Nitro / Vercel / Cloudflare)  Worker Deploy (Docker / VM / PM2)
```

---

## 2. Pre-Deployment Release Checklist

Before promoting any release to Staging or Production:

- [ ] All CI automated tests pass (`npm test`).
- [ ] TypeScript typecheck passes (`npm run typecheck`).
- [ ] ESLint / Prettier formatting passes (`npm run lint`).
- [ ] Secrets scan passes (`node --experimental-strip-types scripts/security-audit.ts`).
- [ ] Database migrations reviewed and backward-compatible.
- [ ] Environment secrets configured in production key management vault (never in repo).
- [ ] Contract address & RPC URLs verified on target EVM network.

---

## 3. Database Migration Deployment Protocol

Supabase migrations in `supabase/migrations/` are append-only and idempotent:

```bash
# 1. Preview changes against target environment
supabase db diff

# 2. Apply migrations to live target
supabase db push

# 3. Validate live database permissions and schema
node --experimental-strip-types scripts/validate-live-db.ts
```

> **Rollback Rule:** Never use `DROP TABLE` or destructive DDL in forward migrations. To roll back a migration, apply an explicit compensating rollback migration file.

---

## 4. Worker Deployment & Supervision

### Option A: Docker Compose

```bash
# Deploy or update worker container
docker compose -f docker-compose.worker.yml pull
docker compose -f docker-compose.worker.yml up -d --remove-orphans
```

### Option B: PM2 (Process Manager)

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
```

### Option C: Systemd

```bash
sudo cp scripts/bluecarbon-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart bluecarbon-worker
sudo systemctl status bluecarbon-worker
```

---

## 5. Post-Deployment Smoke Testing

Verify the deployed environment immediately after release:

```bash
node --experimental-strip-types scripts/smoke-test.ts --strict
```

Checks:

- Web HTTP endpoint responds with `< 400` status.
- Worker liveness probe `/healthz` returns `200 OK`.
- Worker readiness probe `/readyz` confirms active DB pool.
- Prometheus metrics `/metrics` are accessible.

---

## 6. Rollback Procedures

### Web Application Rollback

- Instant rollback to the previous deployment artifact via Vercel / Cloudflare / container orchestrator (zero downtime).

### Outbox Worker Rollback

1. Stop running worker:
   ```bash
   pm2 stop bluecarbon-outbox-worker
   # or
   docker compose -f docker-compose.worker.yml down
   ```
2. Check outbox for orphaned leases:
   ```bash
   node --experimental-strip-types scripts/disaster-recovery-reconcile.ts
   ```
3. Re-deploy previous stable worker container tag.
4. Verify `/healthz` and `/readyz`.

---

## 7. Branch Protection, CI Release Gates & Environment Staging

To prevent unreviewed or breaking changes from degrading production security, the repository implements strict GitHub release gates and branch protection rules.

### Branch Protection Invariants (`main` branch)

1. **Require Pull Request Reviews**: Direct pushes to `main` are restricted. All changes require an approved Pull Request with code owner verification.
2. **Require Passing CI Release Gates**: The GitHub Actions workflow enforces three sequential gates:
   - `test`: Executes all unit, integration, and security canary suites (including real PGlite database migration and RLS evaluation, plus Solidity compilation and contract tests).
   - `build`: Validates TypeScript strict compilation and client/server bundle output.
   - `release-gate`: Runs the automated smoke test resilience harness and worker crash-recovery drills under stress conditions, failing if any git working tree drift is detected.
3. **Require Up-to-Date Branches**: Branches must be rebased or merged with `main` before merging to prevent race conditions in schema or contract changes.
4. **Include Administrators**: Governance rules and timelock checks cannot be bypassed by repository administrators.

### Staging Environment Promotion Protocol

Every release must deploy to a dedicated staging environment before production promotion:

- **Isolated Database**: Dedicated Supabase staging project with fresh migrations applied and validated via `scripts/validate-live-db.ts`.
- **EVM Testnet Validation**: Connected to Polygon Amoy or Ethereum Sepolia testnet with contract bytecode and chain ID explicitly verified via `validateEVMNetworkAndContract`.
- **Synthetic Traffic & Probes**: Pre-release automated smoke testing (`scripts/smoke-test.ts --strict`) and lease recovery verification run prior to DNS switchover.

---

## 8. Completed Disaster Recovery & Crash Recovery Drill Evidence

### Drill Objective

Validate zero credit duplication, zero orphaned leases, and safe replay reconciliation under worker crashes, network partitions, and database restoration scenarios.

### Execution Record

| Drill ID  | Scenario Tested                                  | Mechanism                                                              | Verification Method                                                                         | Outcome                                                                                                                              |
| :-------- | :----------------------------------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------- |
| **DR-01** | Concurrent worker lease contention               | `claim_outbox_job` with PostgreSQL `FOR UPDATE SKIP LOCKED`            | Multi-worker parallel claim test (`tests/verification/crash-recovery-concurrency.test.ts`)  | **PASS** — Exactly 1 worker acquires lease; no lock starvation or duplicate claims.                                                  |
| **DR-02** | Worker crash after on-chain mining               | Self-healing via `BlueCarbonRegistry.records(recordHash)` verification | Simulated sudden process termination after EVM receipt confirmation                         | **PASS** — Resuming worker detects verified on-chain anchor, marks outbox job complete, and avoids duplicate transaction submission. |
| **DR-03** | Compound error handling during failure recording | Nested error logging & DLQ routing                                     | Injected failure in `fail_outbox_job` RPC                                                   | **PASS** — Throws explicit compound error; worker supervisor safely isolates task without silent drop.                               |
| **DR-04** | Live EVM identity & contract validation          | `validateEVMNetworkAndContract`                                        | RPC chain ID mismatch and missing bytecode injection                                        | **PASS** — Rejects transaction when RPC reports incorrect chain ID or target address lacks deployed code.                            |
| **DR-05** | Durable SIWE nonce & KYC limit persistence       | PostgreSQL tables `siwe_nonces` and `kyc_compliance_transactions`      | PGlite in-memory migration & replay testing (`tests/security/database-integration.test.ts`) | **PASS** — Atomic nonce consumption prevents replay attacks; rolling 365-day cumulative volume limits enforce Tier 1 compliance.     |

### Sign-off & Audit Record

- **Audit Reference:** Production Readiness Hardening & Disaster Recovery Drill
- **Status:** **VERIFIED & COMPLETED**
- **Zero Invariant Violations Recorded.**
