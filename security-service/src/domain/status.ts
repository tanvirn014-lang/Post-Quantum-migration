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
    summary: "Allow-listed provider and group registry; versioned, audited selection of the active TLS profile, which the sidecar polls and applies to new connections without a restart.",
    evidence: ["security-service/tests/config.test.ts", "pqc-sidecar/tests/sidecar.test.ts"],
    limitations: [
      "Configuration-level selection only: the TLS library performs the handshake; per-operation provider substitution is not implemented.",
      "A change affects NEW connections; connections already established keep what they negotiated.",
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
    status: "LIVE",
    summary:
      "Perimeter TLS 1.3-only terminator on Node.js/OpenSSL 3.5 that negotiates X25519MLKEM768 with capable peers over mutual TLS, verifies the negotiated group from the ServerHello on the wire, and forwards allow-listed requests to the core with a signed peer assertion.",
    evidence: ["pqc-sidecar/tests/wire.test.ts", "pqc-sidecar/tests/sidecar.test.ts"],
    limitations: [
      "Certificate authentication stays classical (ECDSA P-256); no post-quantum signatures.",
      "Protects only traffic routed through it; the sidecar-to-core hop is plain HTTP on a private network.",
      "node:tls cannot report a hybrid group, so the negotiated group is read from the plaintext ServerHello (verified handshake trace); the implementation stack is Node.js/OpenSSL rather than the Java/BCJSSE named in the proposal.",
    ],
  },
  {
    id: "fallback-enforcement",
    name: "Classical fallback and policy-violation detection",
    status: "LIVE",
    summary:
      "Every connection ends in exactly one decision: hybrid accepted, classical accepted only as an explicitly labelled fallback for classical-allowed peers, or rejected (policy violation / unknown peer). Each decision is recorded with the expected profile and observed group.",
    evidence: ["pqc-sidecar/tests/policy.test.ts", "pqc-sidecar/tests/sidecar.test.ts", "pqc-sidecar/tests/scenarios.test.ts"],
    limitations: [
      "Detects policy violations visible to the sidecar; from a ClientHello alone it cannot tell a stripped hybrid group from a client that never supported it (shown by the controlled-modification scenario).",
      "No revocation checking; a single trusted CA signs peer certificates.",
    ],
  },
  {
    id: "peer-simulator",
    name: "Simulated external peers and controlled ClientHello modification",
    status: "SIM",
    summary: "Simulated hybrid-capable, classical-only, unregistered and untrusted peers plus an on-path proxy that strips the hybrid group, used to run experiments B and C.",
    evidence: ["pqc-sidecar/tests/scenarios.test.ts"],
    limitations: ["Peers are simulated on one host; real partner interoperability is future work.", "The tamper proxy is a test tool, never part of the sidecar data path."],
  },
  {
    id: "cbom",
    name: "CBOM generator, validation and ground-truth comparison",
    status: "LIVE",
    summary: "CycloneDX 1.7 cryptographic bill of materials built from a hand-maintained usage register, public certificate files, an allow-listed dependency scan and observed handshake telemetry; validated against the official schema and compared with a scoped ground truth (TP/FP/FN, completeness, precision).",
    evidence: ["security-service/tests/cbom.test.ts", "security-service/ground-truth/cbom-ground-truth.json", "security-service/schemas/cyclonedx-1.7/MANIFEST.md"],
    limitations: [
      "Completeness is only defined against a scoped manual ground truth; this is not full cryptographic discovery.",
      "Declared usage comes from a maintained register (tokens re-checked in files), not source-code analysis; hard-coded or dynamic use outside the register is invisible unless it shows up in telemetry.",
      "The ground truth was prepared by an AI assistant by manual inspection, by the same agent that wrote the generator; a human reviewer must confirm it before any research claim.",
      "Certificates and token signatures are inventoried as classical (ECDSA / EdDSA); the inventory says nothing about quantum safety.",
    ],
  },
  {
    id: "partner-integration",
    name: "Sidecar-asserted partner payment API",
    status: "LIVE",
    summary: "The core accepts partner payments only with a signed sidecar assertion and records the verified key exchange (peer, group, decision) with each transaction.",
    evidence: ["ledger-service/tests/http/partner.test.ts", "pqc-sidecar/tests/scenarios.test.ts"],
    limitations: ["The sidecar-to-core hop is plain HTTP on a private network, protected by an HMAC-signed assertion rather than TLS.", "Only credits to customer accounts are accepted; this is not a full payment-network integration."],
  },
  {
    id: "hndl-simulator",
    name: "HNDL educational simulator",
    status: "SIM",
    summary:
      "Real X25519 / ML-KEM-768 / HKDF / AES-GCM on throw-away keys: a toy session is captured under a classical and a hybrid key agreement, and a modelled adversary is handed the private half of whatever the chosen assumption declares broken. Includes a Mosca X+Y>Z calculator.",
    evidence: ["security-service/tests/hndl.test.ts", "security-service/tests/research.test.ts"],
    limitations: [
      "Didactic only: no quantum computation, no cryptanalysis of any real key, no prediction of when a quantum computer will exist; the break is an assumption chosen by the user.",
      "Shows key establishment only; it says nothing about certificates, stored data or other hops.",
    ],
  },
  {
    id: "benchmark-harness",
    name: "Benchmark harness and environment manifest",
    status: "LIVE",
    summary:
      "Interleaved classical-versus-hybrid TLS 1.3 handshake measurements against a separate server process, with raw per-handshake CSV, bootstrap confidence intervals over runs and an automatically captured environment manifest; results are ingested as immutable evidence.",
    evidence: ["pqc-sidecar/tests/bench.test.ts", "security-service/tests/research.test.ts"],
    limitations: ["Single host, loopback; results are not production network latency.", "Measures handshake cost only, not application throughput; the CI is over runs on one machine, not across machines."],
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
