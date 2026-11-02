# M7 — High availability and disaster recovery

Clear boundary between what is **verified locally here** and what is a **production/infrastructure
claim that is NOT verified** in this repo.

## Delivered and verified locally (LOCAL)

### Backup and restore (DR primitive)
`scripts/db-backup.mjs` (logical `pg_dump -Fc` via the Postgres container, with a SHA-256 checksum)
and `scripts/db-restore.mjs` (restore into a FRESH database, so a restore never touches the source).
Exposed as `npm run db:backup [db]` and `npm run db:restore <dumpFile> <targetDb>`.

**Verified on this machine (2026-11-02):** a 25-row source database was backed up (2,995-byte
custom-format dump + sha256) and restored into a fresh database with **25 rows**, matching the
source. Non-destructive (throwaway demo databases, dropped afterwards).

```
backup written: <dir>/<ts>-dr_demo_src.dump
sha256: 00c9e572035ede5999805bf848df7e0d46080bd5cf946d8a12e5529a94f26625
restored ... into database "dr_demo_restored"
restored rows: 25
```

### Container images (IaC)
Multi-stage, non-root, dev-dependency-pruned **Dockerfiles** for all four services
(`ledger-service/Dockerfile`, `security-service/Dockerfile`, `pqc-sidecar/Dockerfile`,
`moneypurse-web/Dockerfile`) with `.dockerignore` files that keep `.env`/`.secrets` out of the build
context. Node 26 is pinned (OpenSSL >= 3.5 for X25519MLKEM768). The sidecar image exposes the TLS
data plane (8443) and the loopback admin probes (8081: healthz/readyz/livez).

> The images are written but **not built in this environment** (building pulls base images and runs
> `npm ci` over the network). Building belongs in CI; pin base images by digest for production.

### Reference topologies (IaC)
- `deploy/docker-compose.prod.yml` — all services built from their Dockerfiles + PostgreSQL, with
  readiness healthchecks and secrets sourced from the environment/secret store (never literals).
- `deploy/postgres-ha/` — a local primary + hot-standby **streaming-replication** compose
  (`init-primary.sh` creates the replication role; the replica base-backs-up on first start). Bring
  up with `docker compose -f deploy/postgres-ha/docker-compose.yml up`; verify with
  `docker exec pg-ha-replica psql -U ledger -tAc "SELECT pg_is_in_recovery()"` → `t`.

## NOT verified here — production infrastructure (INFRA)
- **Replication running / failover under load** — the HA compose is an artifact; it is not brought up
  or failover-drilled in this environment. True HA needs a quorum/failover controller (Patroni,
  cloud-managed Postgres), not a single-host pair.
- **PITR / WAL archiving**, **offsite + immutable (ransomware-resistant) backups**, backup retention
  and encryption of backups at rest.
- **Kubernetes / Helm**, an ingress/LB with TLS termination, multi-AZ/region, autoscaling.
- **Measured RPO/RTO** under representative load.

## Requirement status
- REL-008 (backup/recovery) → **PARTIAL**: logical backup+restore implemented and locally verified;
  offsite/immutable/PITR are INFRA.
- REL-002/007/012 (HA/failover/AZ loss) → **PARTIAL**: local primary+replica topology provided as an
  artifact; running HA and failover are INFRA/UNVERIFIED.
- OPS-007/011/014 (deploy/IaC/rollout) → **PARTIAL**: Dockerfiles + compose written; a real
  orchestrator, CD and rollback drills are INFRA.
- REL-009/010/011 (RPO/RTO, DR test) → **NOT verified**: definitions + a tested DR drill require a
  production-like environment.
