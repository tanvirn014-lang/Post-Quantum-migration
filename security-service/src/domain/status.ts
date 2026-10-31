/**
 * Implementation status registry: the single declared answer to "what is real in this
 * prototype". Vocabulary follows proposal Appendix B (LIVE / SIM / PLANNED). A component may
 * only be marked LIVE or SIM when it lists evidence (repo-relative paths to tests or artifacts),
 * and tests/status.test.ts verifies that every evidence path exists - so a status cannot claim
 * evidence that is not in the repository. Update this file in the same commit as the change.
 */

export type ImplementationStatus = "LIVE" | "SIM" | "PLANNED";

export interface ComponentStatus {
  id: string;
  name: string;
  status: ImplementationStatus;
  summary: string;
  /** Repo-relative paths to automated tests or retained artifacts backing LIVE/SIM claims. */
  evidence: string[];
  /** Honest limits that must be shown next to the status. */
  limitations: string[];
  /** Out-of-scope items stay PLANNED forever in this prototype (proposal section 21). */
  outOfScope?: boolean;
}

export const COMPONENTS: readonly ComponentStatus[] = [
  {
    id: "ledger-core",
    name: "Banking core (double-entry ledger)",
    status: "LIVE",
    summary: "Accounts, atomic balanced postings, idempotent transfers, PostgreSQL with a balance-enforcing trigger.",
    evidence: ["ledger-service/tests/app/ledger-service.test.ts", "ledger-service/tests/adapters/postgres-ledger-store.integration.test.ts"],
    limitations: ["A minimal Fineract-like reference core, not a real bank core."],
  },
  {
    id: "identity-rbac",
    name: "Authentication, authorization and RBAC",
    status: "LIVE",
    summary: "scrypt passwords, short-lived EdDSA access tokens with JWKS, refresh rotation with reuse detection, lockout, four roles.",
    evidence: ["ledger-service/tests/http/auth.test.ts", "ledger-service/tests/http/rbac.test.ts", "ledger-service/tests/identity/crypto.test.ts"],
    limitations: [
      "Token signatures are classical (EdDSA); no post-quantum signatures or JWT migration (out of scope).",
      "security-service honours an access token until it expires even if the account is disabled meanwhile.",
    ],
  },
  {
    id: "audit-log",
    name: "Tamper-evident audit log",
    status: "LIVE",
    summary: "Append-only, hash-chained audit tables in both services with a verification endpoint; the database refuses UPDATE/DELETE/TRUNCATE.",
    evidence: ["ledger-service/tests/audit/chain.test.ts", "ledger-service/tests/adapters/postgres-identity-audit.integration.test.ts", "security-service/tests/audit.test.ts"],
    limitations: ["Truncating the newest events is only detectable against an externally recorded head hash.", "Not a WORM store; a database superuser can bypass the triggers (and verification then reports the break)."],
  },
  {
    id: "peer-registry",
    name: "Per-peer policy registry",
    status: "LIVE",
    summary: "Peers identified by client-certificate fingerprint with a hybrid-required or classical-allowed profile; unregistered certificates are denied by default.",
    evidence: ["security-service/tests/peers.test.ts"],
    limitations: ["The registry stores policy; enforcement is performed by the sidecar."],
  },
  {
    id: "crypto-agility-config",
    name: "CryptoProvider registry and TLS profile configuration",
    status: "LIVE",
    summary: "Allow-listed provider and group registry; versioned, audited selection of the active TLS profile that the sidecar polls.",
    evidence: ["security-service/tests/config.test.ts"],
    limitations: [
      "Configuration-level selection only: the TLS library performs the handshake; per-operation provider substitution is not implemented.",
      "Only one provider (Node.js TLS / OpenSSL) is selectable; the Bouncy Castle provider named in the proposal is PLANNED.",
    ],
  },
  {
    id: "policy-telemetry",
    name: "Policy and connection telemetry store",
    status: "LIVE",
    summary: "Idempotent ingestion of per-connection events with derived severity, alert acknowledgement and aggregate statistics.",
    evidence: ["security-service/tests/telemetry.test.ts"],
    limitations: ["Events contain only what the sidecar could observe; a logged event is not proof of attack attribution."],
  },
  {
    id: "hybrid-tls-sidecar",
    name: "Hybrid TLS 1.3 sidecar (X25519MLKEM768)",
    status: "PLANNED",
    summary: "Perimeter TLS 1.3 terminator negotiating the hybrid group with capable peers.",
    evidence: [],
    limitations: ["Certificate authentication stays classical.", "Protects only traffic routed through it; the sidecar-to-core hop is plain HTTP on a private network."],
  },
  {
    id: "fallback-enforcement",
    name: "Classical fallback and policy-violation detection",
    status: "PLANNED",
    summary: "Expected-profile versus observed-group enforcement with reject-or-alert outcomes.",
    evidence: [],
    limitations: ["Detects policy violations visible to the sidecar; it cannot prove a ClientHello was stripped by an on-path attacker."],
  },
  {
    id: "cbom",
    name: "CBOM generator, validation and ground-truth comparison",
    status: "PLANNED",
    summary: "CycloneDX cryptographic bill of materials from declared and observed sources.",
    evidence: [],
    limitations: ["Completeness is only defined against a scoped manual ground truth; this is not full cryptographic discovery."],
  },
  {
    id: "hndl-simulator",
    name: "HNDL educational simulator",
    status: "PLANNED",
    summary: "Toy capture scenario with supplied secrets.",
    evidence: [],
    limitations: ["Didactic only: no quantum computation, no cryptanalysis, no prediction of when a quantum computer will exist."],
  },
  {
    id: "benchmark-harness",
    name: "Benchmark harness and environment manifest",
    status: "PLANNED",
    summary: "Interleaved classical-versus-hybrid handshake measurements with raw CSV and manifest.",
    evidence: [],
    limitations: ["Single host, loopback; results are not production network latency."],
  },
  {
    id: "dashboard",
    name: "Security dashboard",
    status: "PLANNED",
    summary: "Operator console for status, telemetry, peers, configuration, CBOM and simulator.",
    evidence: [],
    limitations: [],
  },
  {
    id: "pq-signatures",
    name: "ML-DSA signatures, PQ certificates, JWT migration",
    status: "PLANNED",
    summary: "Post-quantum authentication and PKI.",
    evidence: [],
    limitations: ["Explicitly out of scope for this prototype (proposal section 21)."],
    outOfScope: true,
  },
];
