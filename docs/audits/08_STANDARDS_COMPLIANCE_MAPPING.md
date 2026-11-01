# Standards Compliance Mapping

**No certification is claimed or inferred.** This maps implemented controls to applicable standards and states, per control: **Verified** (standard requirement met + evidence), **Partial**, **Missing**, **Applicability unknown**, or **Independent certification / legal verification required**. Standard *applicability* to a research prototype is itself often conditional; numeric targets in the master prompt are proposed engineering targets, not regulatory obligations.

| Standard | Area | Status | Notes / evidence |
|---|---|---|---|
| **RFC 8446 (TLS 1.3)** | Protocol conformance | **Partial (verified behavior)** | Uses OpenSSL TLS 1.3, min+max pinned; transcript auth makes tamper fail. Conformance verified behaviorally on the wire, not by a formal RFC conformance suite. `pqc-sidecar/src/wire`, tests |
| **FIPS 203 (ML-KEM)** | PQ KEM | **Partial** | ML-KEM-768 via OpenSSL 3.5 / `node:crypto`; used in `X25519MLKEM768` and the HNDL simulator. Not independently FIPS-validated (uses whatever OpenSSL embeds) → **independent validation required** for any FIPS claim |
| **draft hybrid KE / IANA code point 0x11ec ("RFC 10024" in proposal)** | Hybrid group | **Partial** | 0x11ec and 1216/1120-B shares observed on the wire (`wire.test.ts`, e2e). **Standards-citation verification still required** beyond observed values (CLAIM_LEDGER §4) |
| **NIST SP 800-227 (KEM usage)** | KEM usage guidance | **Applicability unknown / Partial** | Hybrid KE + fail-closed on unknown group aligns in spirit; no formal mapping performed |
| **CycloneDX / ECMA-424 (1.7)** | CBOM format | **Verified (format)** | Schema-valid against vendored official schema with pinned hashes (`security-service/src/cbom/validate.ts`, `schemas/.../MANIFEST.md`). Completeness is scoped + ground-truth independence pending |
| **ISO/IEC 25010** | Product quality | **Partial** | Functional suitability, maintainability (hexagonal, ADRs), security primitives strong; reliability/performance-efficiency (HA/SLO) largely missing |
| **ISO/IEC 27001 / 27002** | ISMS / controls | **Partial / Missing** | Technical controls (access control, crypto, logging, change control) partially present; **ISMS, risk treatment, policies, management system Missing** → independent certification required |
| **ISO 22301** | Business continuity | **Missing** | No BCP/DR (REL/GOV) |
| **NIST CSF 2.0** | Govern/Identify/Protect/Detect/Respond/Recover | **Partial** | Protect (authz, crypto, validation) + Detect (telemetry, audit) partial; **Govern/Respond/Recover Missing** (no risk register, IR, DR) |
| **NIST SP 800-63** | Identity assurance | **Partial** | scrypt + policy + lockout + refresh rotation (AAL-ish); **no MFA (IAL/AAL gaps)**; Supabase OTP demo-grade |
| **OWASP ASVS** | App security verification | **Partial** | V2 auth, V3 session, V4 access control, V5 validation, V7 logging largely present; V6 crypto-at-rest, V1 architecture (threat model), V14 config (secrets mgmt) partial |
| **OWASP API Security Top 10** | API risks | **Partial** | BOLA (ownership checks), broken auth (JWT/guards), resource consumption (rate limits) addressed; inventory/OpenAPI, unsafe consumption (Supabase `aud`) gaps |
| **PCI DSS** | Card data | **Not applicable (no card scope)** | No PAN/card processing present; becomes **required** only if card data enters scope |
| **WCAG 2.2 AA** | Accessibility | **Partial** | Radix primitives, text-labelled status, tabular nums, roles/aria; **no automated conformance evidence** (UX-001) |
| **ISO 20022** | Payment messaging | **Not applicable (prototype)** | No payment-message interoperability implemented; required only if that interoperability is in scope |
| **Bangladesh Bank ICT Security Guidelines** | Jurisdictional | **Applicability unknown → independent legal/regulatory verification required** | BD market signals (BDT/৳, bKash fixture); no jurisdiction mapping (GOV-001); no localization (UX-007) |
| **Basel operational-resilience principles** | Op resilience | **Missing** | No availability/continuity/third-party-risk program (REL/GOV) |

## Cross-cutting
- **Supply chain:** lockfile integrity + crypto-lib CBOM scan (Partial); **no dependency SBOM, no vuln scanning, no provenance** (Missing) — relevant to SLSA/27002 supply-chain controls.
- **Cryptographic agility / inventory:** provider registry + CBOM (Verified at prototype scope) — aligns with NIST PQC-migration guidance intent; independent CBOM ground truth still required.
- **Honesty / claim control:** `scripts/claim-audit.mjs` + status registry enforce no over-claiming — a strong governance signal for GOV-008/012, though not itself a certified control.

**Bottom line:** the prototype demonstrates *controls aligned with* several standards' technical intent (TLS 1.3, CycloneDX, access control, logging), but **no standard is fully met at an organizational/management-system level, and no certification exists or is claimed.** Any compliance assertion requires independent assessors and legal verification per deployment jurisdiction.
