# Completion guide — the four milestones needing human work + infrastructure decisions

For M4 (the KMS/HSM + at-rest remainder), M7 (HA/DR), M8 (production mTLS/PKI) and M9 (independent
CBOM validation), the in-repo slice is done and verified; what is left needs **decisions a person
must make** and **infrastructure or an independent human** to execute. This guide gives, per
milestone: the decisions to make, step-by-step instructions, recommendations grounded in recognised
standards, and the acceptance criteria that make the requirement VERIFIABLE (not merely claimed).

Standards referenced: NIST SP 800-57 (key management), FIPS 140-3 (crypto modules/HSM), NIST SP
800-34 & ISO 22301 (contingency / business continuity), RFC 8446 (TLS 1.3), RFC 5280 (X.509), RFC
6960 (OCSP), CycloneDX / ECMA-424 (CBOM), ISO/IEC 27001/27002, PCI DSS (where card scope applies),
and the project proposal's Appendix E/F method. **None of the items below should be reported VERIFIED
until its acceptance criteria are met with real evidence; until then they stay PARTIAL / BLOCKED /
PENDING.**

---

## M4.e — KMS/HSM and encryption at rest

**Done (local):** a `KeyManagementService` port + `DevKms` envelope encryption; `customers.full_name`
encrypted at rest in Postgres; master-key rotation; fail-closed behaviour (`ledger-service/src/crypto/kms.ts`).
**Left (infra + decisions):** a real key-management backend, encryption of the data at rest beneath
the application, and a formal key-management policy.

### Decisions to make
1. **KMS/HSM backend.** Managed cloud KMS (AWS KMS, GCP Cloud KMS, Azure Key Vault) vs self-hosted
   **HashiCorp Vault** (`transit` engine) vs a dedicated **HSM** (Thales/Entrust/CloudHSM). For a bank,
   the master/root keys should live in a **FIPS 140-3 (or 140-2 L3+) validated HSM** or a KMS backed by
   one.
2. **Key hierarchy.** Root/KEK in the HSM/KMS; per-service or per-data-class **data keys (DEKs)** wrapped
   by the KEK (envelope encryption — already the shape of `DevKms`). Decide the granularity (per-tenant?
   per-table?).
3. **Rotation cadence & crypto-period** (NIST SP 800-57 Part 1): e.g. KEK rotated annually (or on
   compromise), DEKs re-wrapped on KEK rotation; set the data-key crypto-period to your risk appetite.
4. **Separation of duties / access** (ISO 27001 A.8, PCI DSS 3.x): who can use vs manage vs export keys;
   dual control / split knowledge for root-key operations; no single person holds the full key.
5. **Data classes to encrypt at rest** (beyond `full_name`): emails, any PII, and consider
   application-level encryption for the most sensitive columns in addition to volume encryption.
6. **At-rest layer.** Transparent Data Encryption / encrypted volumes (cloud disk encryption, LUKS) for
   the database **and** backups, **in addition to** the application-level field encryption already built.

### Step-by-step
1. Stand up the chosen KMS/HSM; create a KEK in a FIPS-validated module; record its ARN/key-id.
2. Implement a `KmsAdapter implements KeyManagementService` for that backend (the port already exists —
   this is a drop-in next to `DevKms`). For Vault: call `transit/encrypt` & `transit/decrypt`. For cloud
   KMS: use `GenerateDataKey` + local AES-GCM with the plaintext DEK, store the wrapped DEK.
3. Wire it in the composition root behind a config flag (mirror how `DevKms` is wired from `KMS_MASTER_KEY`).
4. Encrypt backups (`scripts/db-backup.mjs`) and enable **TDE / encrypted volumes** on the DB host.
5. Run the existing KMS tests against the real adapter where feasible (round-trip, rotation, fail-closed,
   wrong-key, KMS-unavailable); add an **access-control test** proving an unauthorised principal cannot
   decrypt.
6. Write the **key-management policy** (owners, rotation schedule, revocation, recovery, audit).
7. **Plan the migration** for existing plaintext rows: a one-off job that reads plaintext → encrypts →
   writes back (enabling KMS on a DB with legacy plaintext otherwise fails closed on read, by design).

### Recommendations
Prefer a managed KMS backed by a FIPS 140-3 HSM to minimise operational key-handling; use **envelope
encryption** (already modelled); **never** store a plaintext long-lived key on disk; log all key-use
to the audit chain; align the policy with NIST SP 800-57 and 800-130.

### Acceptance (then SEC-007/009 → VERIFIED)
Keys generated and used only inside the HSM/KMS; DEKs wrapped by the KEK; a documented, exercised key
rotation; at-rest encryption on the DB and backups; access-control test green; key-management policy
signed off; legacy data migrated. Evidence: KMS config, rotation run output, encrypted-volume proof,
test results, the policy doc.

---

## M7 — High availability and disaster recovery

**Done (local):** verified logical backup/restore (`scripts/db-backup.mjs` / `db-restore.mjs`), non-root
Dockerfiles, `deploy/docker-compose.prod.yml`, and a local primary+replica compose (`deploy/postgres-ha/`).
**Left (infra + decisions):** running HA, tested failover, point-in-time recovery, offsite backups, an
orchestrator, and defined/validated RPO/RTO.

### Decisions to make
1. **RPO / RTO targets** per critical service (NIST SP 800-34, ISO 22301). For authoritative financial
   state, aim for **RPO ≈ 0** (synchronous replication) and an RTO your business continuity plan sets
   (minutes).
2. **Managed vs self-managed Postgres.** Managed (RDS/Cloud SQL/Azure Postgres/AlloyDB) gives HA,
   backups and PITR out of the box; self-managed needs **Patroni** (or Stolon) + etcd/Consul for quorum
   and automatic failover.
3. **Replication mode.** Synchronous (zero data loss, higher latency) for the ledger; async acceptable
   for less critical data. Decide quorum (e.g. `synchronous_standby_names`).
4. **Backup strategy — 3-2-1** and PITR: base backups + **WAL archiving** (pgBackRest / WAL-G) to
   **offsite, immutable** storage (object-lock / WORM) to resist ransomware; set **retention**.
5. **Orchestration.** Kubernetes + Helm (with the Dockerfiles provided), a Postgres operator
   (CloudNativePG / Zalando), ingress/LB with TLS termination, multi-AZ (and multi-region if the
   availability target requires).
6. **DR test cadence** (e.g. quarterly game-days) and who runs them.

### Step-by-step
1. Build and publish the four images from the provided Dockerfiles in CI (pin bases by digest, scan them).
2. Deploy via the Postgres operator (managed PITR + sync replication) or Patroni; expose the app services
   behind an ingress/LB that terminates TLS.
3. Configure **pgBackRest/WAL-G**: scheduled base backups + continuous WAL archiving to offsite immutable
   storage; verify a **restore to a point in time** on a scratch instance.
4. Automate `scripts/db-backup.mjs` restores as a periodic **restore-verification** job (a backup you
   cannot restore is not a backup).
5. Run a **failover drill**: kill the primary, confirm the standby is promoted, the app reconnects, and
   measure the actual RPO/RTO against targets. Record results.
6. Write the **DR runbook + business-continuity plan** (roles, escalation, step-by-step recovery).

### Recommendations
Use a managed Postgres or a well-run operator rather than hand-rolled replication; make **restore**, not
just backup, the tested artefact; keep backups **encrypted and immutable offsite**; treat the single-host
`deploy/postgres-ha/` compose only as a learning/failover-mechanics sandbox, never as production HA.

### Acceptance (then REL-002/007/008/009/010/011 → VERIFIED)
A tested failover meeting the declared RPO/RTO; PITR demonstrated; offsite immutable backups with a
verified restore; a DR drill with recorded evidence; the BCP/runbook signed off.

---

## M8 — Internal mTLS and PKI (production)

**Done (local):** a dev PKI (internal CA → ECDSA server/client certs), a TLS 1.3 mutual-TLS transport
with a revocation deny-list, and real-TLS tests (`pqc-sidecar/src/internal-mtls.ts`,
`docs/audits/12_HOP_PROTECTION.md`). **Left (infra + decisions):** wiring mTLS into the live
sidecar→core path, a production PKI with lifecycle/revocation, and TLS on the remaining hops.

### Decisions to make
1. **Service-identity / mTLS approach.** A **service mesh** (Istio, Linkerd) that gives automatic mTLS +
   rotation, or **SPIFFE/SPIRE** for workload identities, or manual mTLS with **cert-manager** /
   **Vault PKI** / **step-ca** issuing short-lived certs. For a bank, automated, short-lived certs via a
   mesh or SPIRE is the recommended baseline.
2. **CA trust root.** An internal CA rooted in an HSM (reuse the M4 HSM), not a long-lived file-based CA.
3. **Certificate lifetime & revocation** (RFC 5280/6960). Prefer **short-lived certs** (hours) so
   revocation is largely unnecessary; where longer-lived, run an **OCSP responder** (RFC 6960) or OCSP
   stapling. The current deny-list is a stopgap.
4. **Every hop's TLS** (see `12_HOP_PROTECTION.md`): terminate TLS at the edge for the web/API, enable
   **TLS to PostgreSQL**, and bring hop 3 (sidecar→security-service) under the same mTLS as hop 2.
5. **PQ posture decision (research-relevant).** Certificates remain **classical** by the proposal's scope;
   if/when NIST PQC signature standards (ML-DSA / FIPS 204) are adopted, PQ or hybrid certificate
   authentication is a *separate* assurance workstream — decide whether it is in scope.

### Step-by-step
1. Expose the ledger core's `/partner/*` on a mutual-TLS listener (the sidecar already forwards over
   https when `UPSTREAM_URL` is https — attach the `internalMtlsAgent`; this is the live-wiring step
   `12_HOP_PROTECTION.md` flags).
2. Replace the dev CA with the production CA (mesh/SPIRE/Vault PKI); issue short-lived service certs with
   correct SAN/EKU (the generators in `pqc-sidecar/src/pki` show the shape).
3. Enable TLS to Postgres (`sslmode=verify-full`) and edge TLS termination for web/API.
4. Stand up OCSP (or adopt short-lived certs + stapling); keep the deny-list as defence-in-depth.
5. Add **positive and negative certificate-validation tests** against the production issuer (valid →
   accept; expired, wrong-CA, revoked, missing SAN/EKU → reject) — extend `internal-mtls.test.ts`.
6. Update `12_HOP_PROTECTION.md` so every hop's row reads VERIFIED with its protection level.

### Recommendations
Automate certificate lifecycle (issuance + rotation) — manual PKI is the main operational risk; favour
short-lived certs over revocation infrastructure; keep the honest per-hop protection table current and
never imply PQ authentication while certificates are classical.

### Acceptance (then SEC-001/002, PQC-012 → VERIFIED)
mTLS enforced on hops 2 and 3 and TLS on hops 4–5, with automated cert lifecycle and working revocation
(OCSP or short-lived), positive/negative validation tests green, and the hop-protection table updated.

---

## M9 — Independent CBOM validation (human)

**Done (local):** an independent ground-truth **template**, a **sourcing guide**, a reproducible
**review procedure**, and the diff tooling already exists (`docs/audits/14_CBOM_GROUND_TRUTH.md`,
`security-service/ground-truth/cbom-ground-truth.template.json`). **Left (human):** the independent human
must actually build the reference inventory and sign off — this **cannot be automated or fabricated**.

### Decisions to make
1. **Who is the independent reviewer.** Must **not** be the author of the CBOM generator and **not** an
   AI acting on that author's behalf (the current ground truth fails this — that is the whole point).
   Ideally a second engineer or an external reviewer; for a stronger result, **two** reviewers for
   inter-rater agreement.
2. **Pre-registration.** The reviewer fixes the scope and method **before** seeing the generator output
   or the AI-prepared ground truth (construct-validity discipline, per the proposal Appendix E and good
   reproducibility practice).
3. **Sign-off threshold.** What completeness/precision/location-recall, and what residual discrepancies,
   are acceptable to call H4 validated — decide and record this in advance.

### Step-by-step (research standard)
1. Assign the independent reviewer(s); confirm independence in writing.
2. Working **only** from `14_CBOM_GROUND_TRUTH.md` §2 (sourcing guide) and the source tree — **not**
   `src/cbom/generator.ts` and **not** the existing ground truth — fill
   `cbom-ground-truth.template.json` → `cbom-ground-truth.independent.json`, recording the exact commit.
3. Install it as the active ground truth (archive the AI-prepared one) and run `compareToGroundTruth`
   (CBOM console / API) to get TP/FP/FN, scoped precision/completeness/location-recall and typed
   discrepancies.
4. **Adjudicate** each discrepancy (generator right, or ground truth right?); if two reviewers, reconcile
   and report inter-rater agreement; record decisions.
5. Complete the **sign-off block** (§5 of `14_…`): reviewer, independence confirmation, commit, date,
   result, statement. Document **threats to validity** (internal/external/construct/conclusion) for the
   write-up (closes RES-018 too).

### Recommendations
Treat this as a measurement with a stated method and a pre-registered threshold; keep raw artefacts (the
independent inventory, the comparison output) for reproducibility; report the gap honestly rather than
tuning the ground truth to flatter the generator.

### Acceptance (then RES-010 / CBOM-005 → VERIFIED)
An independent human (not the generator's author) has produced the reference inventory, run the
comparison, adjudicated discrepancies, and signed off against the pre-registered threshold — with the
artefacts retained. Only then may the completeness/precision figures be cited as validated.

---

## Priority order for the human work
1. **M4.e key management** (unblocks M7 backup encryption and M8's HSM-rooted CA).
2. **M8 production PKI + mTLS** (uses the M4 HSM; closes the internal-hop confidentiality gap).
3. **M7 HA/DR** (depends on the deployment + encrypted backups).
4. **M9 independent CBOM sign-off** (parallelisable any time; needs only a person, not infrastructure).

Each, once its acceptance criteria are met with retained evidence, moves its requirements from PARTIAL
to VERIFIED in `docs/PROJECT_STATUS.md` and `docs/audits/01_COMPLETE_NFR_AUDIT.md`. Until then they remain
honestly labelled INFRA / HUMAN and are not claimed complete.
