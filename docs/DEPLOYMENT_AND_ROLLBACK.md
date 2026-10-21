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
