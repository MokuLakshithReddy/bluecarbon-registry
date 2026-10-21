# Disaster Recovery & State Reconciliation Specification

**Registry System:** BlueCarbon MRV Registry  
**Owner:** Ministry of Earth Sciences (MoES) / NCCR Implementation Team  
**Audit Reference:** P1 — Recovery: Test backup and disaster recovery

---

## 1. Objectives & Metrics

| Metric                             | Target                        | Rationale                                                                                                 |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Recovery Point Objective (RPO)** | **< 1 minute**                | Continuous Write-Ahead Logging (WAL) and Supabase Point-in-Time Recovery (PITR).                          |
| **Recovery Time Objective (RTO)**  | **< 15 minutes**              | Fully scripted container recovery, automated database migrations, and autonomous on-chain reconciliation. |
| **Data Loss Tolerance**            | **Zero for verified records** | All verified carbon decisions are durably anchored on the public EVM blockchain.                          |

---

## 2. Backup Strategy

1. **Continuous WAL Archiving**:
   - Supabase Enterprise/Pro tier Point-in-Time Recovery (PITR) retains continuous transaction logs.
   - Restores can be initiated to any second within the retention window (7–30 days).
2. **Daily Logical Dumps**:
   - Automated pg_dump snapshot stored in encrypted, immutable Cloud Storage with Object Versioning and 90-day retention lock.
3. **Evidence Storage Buckets**:
   - Supabase S3-compatible storage objects have cross-region replication (CRR) and versioning enabled to prevent accidental deletion or corruption.

---

## 3. Disaster Scenarios & Recovery Procedures

### Scenario A: Outbox Worker Crash or Abnormal Termination

- **Impact:** Worker abruptly crashes while holding active leases (`locked_until`).
- **Resolution:**
  1. The worker process is monitored by systemd / PM2 / Docker with `restart: unless-stopped`.
  2. The database automatically reclaims orphaned jobs once `locked_until < now()` via `claim_next_outbox_job`.
  3. No operator intervention required.

### Scenario B: Crash Between On-Chain Submission and Database Finalization

- **Impact:** The EVM transaction succeeded and was mined into a block, but the worker process crashed before invoking `confirm_blockchain_anchor`.
- **Resolution:**
  1. When a worker claims the retried job, `anchor()` performs an idempotency pre-check (`verifyRecord(recordHash)`).
  2. If the record exists in the contract, it extracts the mined `blockNumber` and confirms the job immediately.
  3. Run the reconciliation tool to sync any remaining records:
     ```bash
     npm run reconcile:state
     ```

### Scenario C: Database Restoration from Backup (PITR)

- **Impact:** Database restored to a point in time prior to recent verification decisions.
- **Resolution:**
  1. Execute all schema migrations:
     ```bash
     supabase db push
     ```
  2. Run the reconciliation script:
     ```bash
     node --experimental-strip-types scripts/disaster-recovery-reconcile.ts
     ```
  3. The script inspects the contract's `RecordAnchored` events, reconstructs the missing `blockchain_records`, and updates project states from `VERIFIED_PENDING_ANCHOR` to `VERIFIED`.

---

## 4. Verification & Testing Protocol

To execute a simulated disaster recovery exercise:

```bash
# 1. Run live database health & schema check
node --experimental-strip-types scripts/validate-live-db.ts

# 2. Run reconciliation dry-run
node --experimental-strip-types scripts/disaster-recovery-reconcile.ts

# 3. Verify test suite passes
npm test
```
