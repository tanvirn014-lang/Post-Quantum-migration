import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CRYPTO_PROVIDERS, TLS_GROUPS, groupByCode, summarizeProfile, validateProfileGroups } from "../src/domain/crypto.js";
import { DECISIONS, isAlertSeverity, severityFor } from "../src/domain/policy.js";
import { COMPONENTS } from "../src/domain/status.js";
import { loadConfig } from "../src/config.js";

// dist/tests/status.test.js -> repository root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("implementation status registry", () => {
  it("has unique component ids", () => {
    const ids = COMPONENTS.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  it("requires evidence for every LIVE or SIM component and none claimed for PLANNED ones", () => {
    for (const c of COMPONENTS) {
      if (c.status === "PLANNED") assert.deepStrictEqual(c.evidence, [], `${c.id} is PLANNED but lists evidence`);
      else assert.ok(c.evidence.length > 0, `${c.id} is ${c.status} without evidence`);
    }
  });

  it("only cites evidence files that exist in the repository", () => {
    for (const c of COMPONENTS) {
      for (const evidence of c.evidence) {
        assert.ok(existsSync(path.join(repoRoot, evidence)), `${c.id}: evidence ${evidence} does not exist`);
      }
    }
  });

  it("keeps out-of-scope items PLANNED", () => {
    for (const c of COMPONENTS.filter((x) => x.outOfScope)) assert.strictEqual(c.status, "PLANNED", c.id);
  });

  it("never describes a component with restricted claim language", () => {
    const restricted = /quantum-proof|fully secure|production-ready|banking compliant|state-of-the-art|emergency swap|real attack simulation/i;
    for (const c of COMPONENTS) {
      assert.doesNotMatch(`${c.name} ${c.summary} ${c.limitations.join(" ")}`, restricted, c.id);
    }
  });
});

describe("TLS group and provider registry", () => {
  it("maps the IANA code points for the two supported groups", () => {
    assert.strictEqual(TLS_GROUPS["X25519MLKEM768"]?.code, 0x11ec);
    assert.strictEqual(TLS_GROUPS["X25519"]?.code, 0x001d);
    assert.strictEqual(groupByCode(0x11ec)?.kind, "hybrid");
    assert.strictEqual(groupByCode(0x1d)?.kind, "classical");
    assert.strictEqual(groupByCode(0xffff), undefined);
  });

  it("validates profiles against the provider", () => {
    assert.deepStrictEqual(validateProfileGroups(["X25519MLKEM768", "X25519"]), []);
    assert.ok(validateProfileGroups(["Nope"]).some((p) => /not in the registry/.test(p)));
    assert.ok(validateProfileGroups(["X25519", "X25519"]).some((p) => /repeat/.test(p)));
    assert.ok(validateProfileGroups([]).some((p) => /between 1 and 4/.test(p)));
    assert.ok(validateProfileGroups(["X25519"], "bcjsse-java").some((p) => /not selectable/.test(p)));
    assert.ok(validateProfileGroups(["X25519"], "unknown").some((p) => /unknown provider/.test(p)));
  });

  it("only ever marks LIVE providers selectable", () => {
    for (const p of CRYPTO_PROVIDERS) if (p.selectable) assert.strictEqual(p.status, "LIVE", p.id);
  });

  it("summarises profiles without overclaiming", () => {
    assert.strictEqual(summarizeProfile(["X25519"]).offersHybrid, false);
    assert.strictEqual(summarizeProfile(["X25519MLKEM768"]).allowsClassical, false);
    assert.match(summarizeProfile(["X25519MLKEM768", "X25519"]).summary, /no post-quantum key-establishment protection/);
  });
});

describe("policy vocabulary", () => {
  it("assigns a severity to every decision and treats only fallback, unknown peers and violations as alerts", () => {
    const alerts = DECISIONS.filter((d) => isAlertSeverity(severityFor(d)));
    assert.deepStrictEqual([...alerts].sort(), ["allowed-fallback", "rejected-unknown-peer", "rejected-violation"]);
    assert.strictEqual(severityFor("rejected-violation"), "critical");
  });
});

describe("configuration", () => {
  const base = { DATABASE_URL: "postgres://x/y", SIDECAR_TOKEN: "s".repeat(32) };

  it("loads a minimal valid environment", () => {
    const c = loadConfig({ ...base, NODE_ENV: "test" });
    assert.strictEqual(c.port, 3200);
    assert.deepStrictEqual(c.corsOrigins, ["http://localhost:3100"]);
  });

  it("requires a long sidecar token and a database", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "test" }), /DATABASE_URL/);
    assert.throws(() => loadConfig({ ...base, SIDECAR_TOKEN: "short" }), /SIDECAR_TOKEN/);
  });

  it("refuses wildcard origins", () => {
    assert.throws(() => loadConfig({ ...base, CORS_ORIGIN: "*" }), /wildcard/);
  });
});
