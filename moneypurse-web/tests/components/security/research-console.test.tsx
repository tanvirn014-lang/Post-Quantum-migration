import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { BenchmarksPanel } from "../../../components/security/BenchmarksPanel.js";
import { CbomPanel } from "../../../components/security/CbomPanel.js";
import { ExperimentsPanel } from "../../../components/security/ExperimentsPanel.js";
import { HndlPanel } from "../../../components/security/HndlPanel.js";
import { apiError, installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { renderWithClient } from "../../helpers/render.js";
import { signInAs, signOut } from "../../helpers/session.js";

const RESTRICTED = /quantum-(proof|safe|resistant)|fully secure|production-ready|banking compliant|state-of-the-art|emergency swap|real attack simulation/i;
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

const CBOM = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  generatedAt: "2026-11-01T10:00:00.000Z",
  generatedBy: "user-1",
  specVersion: "1.7",
  serialNumber: "urn:uuid:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  contentSha256: "ab".repeat(32),
  assets: { total: 24, declared: 22, observed: 2 },
  lookbackHours: 24,
  validation: { valid: true, schema: "CycloneDX 1.7 JSON (official schema, vendored)", errors: [] },
  sourceSummary: {
    certificates: { refused: [{ path: "pki/peer.key.pem", reason: "path looks like private key material; not opened" }] },
    declaredRegister: { unverifiedLocations: [] },
    telemetry: { lookbackHours: 24, eventsInWindow: 40, distinctTuples: 3 },
  },
};

const GROUND_TRUTH = {
  version: 1,
  createdAt: "2026-11-01T09:00:00.000Z",
  createdBy: null,
  scope: "Cryptography used by this repository only.",
  preparedBy: "An AI assistant, by manual inspection of the repository.",
  itemCount: 30,
  contentSha256: "cd".repeat(32),
};

const COMPARISON = {
  id: "cmp-1",
  cbomId: CBOM.id,
  groundTruthVersion: 1,
  createdAt: "2026-11-01T10:05:00.000Z",
  createdBy: "user-1",
  metrics: {
    groundTruthItems: 30,
    generatedAssets: 24,
    truePositives: 24,
    falsePositives: 0,
    falseNegatives: 6,
    completeness: 0.8,
    precision: 1,
    denominators: { completeness: "matched ground-truth items / ground-truth items (24 / 30)", precision: "matched generated assets / generated cryptographic assets (24 / 24)" },
    provenanceAgreement: { matched: 24, agreeing: 24, ratio: 1 },
    locationRecall: { groundTruthLocations: 84, found: 33, ratio: 0.3929 },
    byKind: {},
  },
  discrepancies: [{ type: "missing", kind: "algorithm", name: "HKDF", detail: "in the ground truth (declared) but absent from the generated CBOM" }],
};

describe("research console panels", () => {
  let stub: InstalledFetch | undefined;
  const realCreate = URL.createObjectURL;
  const anchor = () => document.createElement("a").constructor as typeof HTMLAnchorElement;
  const realClick = anchor().prototype.click;
  beforeEach(() => {
    // jsdom has no object URLs and cannot navigate to one; the download helper only needs both to exist.
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
    anchor().prototype.click = () => {};
  });
  afterEach(async () => {
    stub?.uninstall();
    cleanup();
    await signOut();
    URL.createObjectURL = realCreate;
    anchor().prototype.click = realClick;
  });

  describe("CBOM", () => {
    const routes = (): Record<string, () => unknown> => ({
      "GET /v1/cbom": () => [CBOM],
      "GET /v1/cbom/ground-truth": () => GROUND_TRUTH,
      [`GET /v1/cbom/${CBOM.id}/comparison`]: () => COMPARISON,
    });

    it("shows a security administrator the list, validation, sources and a comparison with its scope and caveats", async () => {
      await signInAs("security_admin");
      stub = installFetch(routes());
      renderWithClient(<CbomPanel />);
      await screen.findByText(/CBOM aaaaaaaa/);
      assert.ok(screen.getByRole("button", { name: "Generate CBOM" }));
      assert.ok(screen.getAllByText("Valid").length >= 2, "schema-valid badge in the list and in the detail");
      assert.ok(await screen.findByText(/1 file\(s\) refused/));
      assert.ok(screen.getByText(/Telemetry window: 24 h, 40 connection events/));

      // Comparison numbers appear together with the ground-truth scope and the plain-language caveats.
      assert.ok(await screen.findByText("80.0%"));
      assert.ok(await screen.findByText("Cryptography used by this repository only."));
      assert.ok(screen.getByText(/An AI assistant, by manual inspection/));
      assert.ok(screen.getByText(/not coverage of all cryptography/i));
      assert.ok(screen.getByText(/needs human review/i));
      assert.ok(screen.getByText(/Precision is structurally easy/));
      assert.ok(screen.getByText("HKDF"));
      assert.strictEqual(document.body.textContent?.match(RESTRICTED), null);
    });

    it("generates with the look-back hours and refuses values outside 1 to 720", async () => {
      await signInAs("security_admin");
      stub = installFetch({ ...routes(), "POST /v1/cbom/generate": () => json(CBOM, 201) });
      renderWithClient(<CbomPanel />);
      const button = (await screen.findByRole("button", { name: "Generate CBOM" })) as HTMLButtonElement;
      const input = screen.getByLabelText("Telemetry look-back (hours)");
      fireEvent.change(input, { target: { value: "721" } });
      assert.strictEqual(button.disabled, true);
      assert.ok(screen.getByText(/Whole hours from 1 to 720/));
      fireEvent.change(input, { target: { value: "48" } });
      assert.strictEqual(button.disabled, false);
      fireEvent.click(button);
      await waitFor(() => assert.strictEqual(stub!.callsTo("POST", "/v1/cbom/generate").length, 1));
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/cbom/generate")[0]?.body, { lookbackHours: 48 });
    });

    it("downloads the CycloneDX document with the bearer token, not through a plain link", async () => {
      await signInAs("auditor");
      stub = installFetch({
        ...routes(),
        [`GET /v1/cbom/${CBOM.id}/document`]: () => new Response("{}", { status: 200, headers: { "content-type": "application/vnd.cyclonedx+json", "content-disposition": 'attachment; filename="cbom-x.cdx.json"' } }),
      });
      renderWithClient(<CbomPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Download CycloneDX JSON" }));
      await waitFor(() => assert.strictEqual(stub!.callsTo("GET", `/v1/cbom/${CBOM.id}/document`).length, 1));
      assert.match(stub.callsTo("GET", `/v1/cbom/${CBOM.id}/document`)[0]?.headers["authorization"] ?? "", /^Bearer /);
    });

    it("shows an auditor everything read-only: no generate and no compare controls", async () => {
      await signInAs("auditor");
      stub = installFetch(routes());
      renderWithClient(<CbomPanel />);
      await screen.findByText(/CBOM aaaaaaaa/);
      assert.strictEqual(screen.queryByRole("button", { name: "Generate CBOM" }), null);
      assert.strictEqual(screen.queryByRole("button", { name: /Compare/ }), null);
      assert.ok(screen.getAllByText(/Read-only/).length >= 1);
    });

    it("runs a comparison for a security administrator when none is stored yet", async () => {
      await signInAs("security_admin");
      stub = installFetch({
        ...routes(),
        [`GET /v1/cbom/${CBOM.id}/comparison`]: () => apiError(404, "NOT_FOUND", "Comparison was not found"),
        [`POST /v1/cbom/${CBOM.id}/compare`]: () => json(COMPARISON, 201),
      });
      renderWithClient(<CbomPanel />);
      assert.ok(await screen.findByText(/has not been compared with the ground truth yet/));
      fireEvent.click(screen.getByRole("button", { name: "Compare with ground truth" }));
      assert.ok(await screen.findByText("80.0%"));
    });

    it("explains the empty state and a failed load", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/cbom": () => [] });
      renderWithClient(<CbomPanel />);
      assert.ok(await screen.findByText("No CBOM generated yet"));
      cleanup();
      stub.uninstall();
      stub = installFetch({ "GET /v1/cbom": () => apiError(500, "INTERNAL_ERROR", "Something broke") });
      renderWithClient(<CbomPanel />);
      assert.ok(await screen.findByText("Something broke"));
    });
  });

  describe("HNDL simulator", () => {
    const RUN = {
      id: "run-1",
      createdAt: "2026-11-01T10:00:00.000Z",
      label: "SIMULATION",
      disclaimer: "Educational simulation. It does not break any real key and runs no quantum algorithm.",
      assumption: "x25519-broken",
      assumptionExplained: "Modelled assumption: a future quantum computer recovers the X25519 private key.",
      sessions: {
        classical: { capture: { clientKeyShareBytes: 32, serverKeyShareBytes: 32, ciphertextHex: "00", ciphertextBytes: 40 }, recovered: true, recoveredPlaintext: "pay 500 to account 7", reason: "The session key depends on X25519 alone." },
        hybrid: { capture: { clientKeyShareBytes: 1216, serverKeyShareBytes: 1120, ciphertextHex: "00", ciphertextBytes: 40 }, recovered: false, recoveredPlaintext: null, reason: "The AES-GCM authentication check fails." },
      },
      takeaways: ["Traffic recorded today can be decrypted later if its key agreement is broken later."],
      primitives: ["X25519 (node:crypto)", "ML-KEM-768 (node:crypto)"],
    };

    it("always shows the SIMULATION label and disclaimer, even before anything is run", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/hndl/runs": () => [] });
      renderWithClient(<HndlPanel />);
      assert.ok(screen.getAllByText("SIMULATION").length >= 1);
      assert.ok(screen.getByText(/does not break any real key/));
      assert.ok(await screen.findByText("No simulation runs yet"));
    });

    it("runs the simulation for an auditor and shows classical opened, hybrid closed, plaintext only where recovered", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/hndl/runs": () => [], "POST /v1/hndl/run": () => json(RUN, 201) });
      renderWithClient(<HndlPanel />);
      fireEvent.change(screen.getByLabelText(/Toy message/), { target: { value: "pay 500 to account 7" } });
      fireEvent.click(screen.getByRole("button", { name: "Run simulation" }));
      await waitFor(() => assert.strictEqual(stub!.callsTo("POST", "/v1/hndl/run").length, 1));
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/hndl/run")[0]?.body, { message: "pay 500 to account 7", quantumAssumption: "x25519-broken" });

      const classical = await screen.findByRole("region", { name: "Classical X25519" });
      const hybrid = screen.getByRole("region", { name: "Hybrid X25519MLKEM768" });
      assert.ok(within(classical).getByText("Yes"));
      assert.ok(within(classical).getByText("pay 500 to account 7"));
      assert.ok(within(hybrid).getByText("No"));
      assert.strictEqual(within(hybrid).queryByText(/Recovered plaintext/), null);
      assert.ok(within(hybrid).getByText("1,216 B"));
      assert.ok(within(hybrid).getByText(/AES-GCM authentication check fails/));
      assert.ok(screen.getByText(/Traffic recorded today can be decrypted later/));
      assert.strictEqual(document.body.textContent?.match(RESTRICTED), null);
    });

    it("blocks an empty or oversized toy message before sending anything", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/hndl/runs": () => [] });
      renderWithClient(<HndlPanel />);
      const run = screen.getByRole("button", { name: "Run simulation" }) as HTMLButtonElement;
      fireEvent.change(screen.getByLabelText(/Toy message/), { target: { value: "" } });
      assert.strictEqual(run.disabled, true);
      fireEvent.change(screen.getByLabelText(/Toy message/), { target: { value: "x".repeat(257) } });
      assert.strictEqual(run.disabled, true);
      assert.ok(screen.getByText(/At most 256 characters/));
      assert.strictEqual(stub.callsTo("POST", "/v1/hndl/run").length, 0);
    });

    it("calculates Mosca with the inputs labelled as an assumption and rejects invalid years", async () => {
      await signInAs("auditor");
      stub = installFetch({
        "GET /v1/hndl/runs": () => [],
        "POST /v1/hndl/mosca": (call: unknown) => ({ ...(call as { body: object }).body, atRisk: true, exposureYears: 3, note: "Years to a relevant quantum computer is your assumption, not a prediction." }),
      });
      renderWithClient(<HndlPanel />);
      const calc = screen.getByRole("button", { name: "Calculate" }) as HTMLButtonElement;
      fireEvent.change(screen.getByLabelText(/Z: assumed years/), { target: { value: "-4" } });
      assert.strictEqual(calc.disabled, true);
      fireEvent.change(screen.getByLabelText(/Z: assumed years/), { target: { value: "12" } });
      fireEvent.click(calc);
      assert.ok(await screen.findByText(/Exposed under this assumption/));
      assert.ok(screen.getAllByText(/not a prediction/i).length >= 1);
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/hndl/mosca")[0]?.body, { shelfLifeYears: 10, migrationYears: 5, yearsToQuantum: 12 });
    });

    it("lists previous runs", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/hndl/runs": () => [RUN] });
      renderWithClient(<HndlPanel />);
      assert.ok(await screen.findByText(/classical opened, hybrid closed/));
    });
  });

  describe("benchmarks", () => {
    const entry = (runId: string, integrity: object, extra: object = {}) => ({
      runId,
      receivedAt: "2026-11-01T10:00:00.000Z",
      label: `label ${runId}`,
      commit: "4d8f47d5a1b2c3d4",
      workingTreeDirty: false,
      csv: { handshakes: { bytes: 1000, sha256: "ab".repeat(32) }, throughput: { bytes: 200, sha256: "cd".repeat(32) } },
      integrity,
      ...extra,
    });
    const cond = (median: number, failed: number) => ({
      attempted: 9000,
      succeeded: 9000 - failed,
      failed,
      configurationMismatches: 0,
      latencyMs: { n: 9000, mean: median + 0.05, stddev: 0.7, min: 1, median, p95: median + 1, p99: median + 2, max: 9 },
      clientHelloRecordBytes: 235,
      serverHelloRecordBytes: 127,
      bytesSentPerHandshake: 235,
      bytesReceivedPerHandshake: 831,
    });
    const detail = (runId: string, integrity: object, failed = 0) =>
      entry(runId, integrity, {
        manifest: { host: { cpuModel: "Test CPU", logicalCores: 16, totalMemoryMiB: 16000 }, runtime: { node: "26.4.0", openssl: "3.5.7" }, workload: { preset: "standard", runs: 30, handshakesPerRunPerCondition: 300 }, caveats: ["Single host over loopback."] },
        summary: {
          latency: {
            classical: cond(1.84, failed),
            hybrid: cond(2.14, 0),
            hybridMinusClassicalMedianMs: { estimate: 0.265, lower: 0.153, upper: 0.384, level: 0.95, resamples: 2000, seed: 1 },
            h2Verdict: "hybrid-slower",
            h1: { extraClientHelloBytes: 1176, extraServerHelloBytes: 1088, extraBytesSent: 1176, extraBytesReceived: 1078 },
          },
          throughput: [{ concurrency: 1, condition: "classical", runs: 3, handshakesPerSecondMedian: 415.6, clientCpuMsPerHandshakeMedian: 1.9, serverCpuMsPerHandshakeMedian: 0.7, serverRssMiBMedian: 130, failures: 0 }],
        },
      });
    const VALID = { status: "valid", problems: [] };
    const INVALID = { status: "invalid", problems: ["classical: 2461 of 9000 handshakes failed (limit 0.5%)"] };

    it("shows a valid run with its tables, H2 wording, caveats and the loopback scope, and no warning banner", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/benchmarks": () => [entry("run-valid-0001", VALID)], "GET /v1/benchmarks/run-valid-0001": () => detail("run-valid-0001", VALID) });
      renderWithClient(<BenchmarksPanel />);
      await screen.findByText("Environment manifest");
      assert.ok(screen.getByText("Test CPU"));
      assert.ok(screen.getByText("1.84 ms"));
      assert.ok(screen.getByText("Hybrid slower"));
      assert.ok(screen.getByText(/lies entirely above zero/));
      assert.ok(screen.getByText("Single host over loopback."));
      assert.ok(screen.getAllByText(/no capacity claim/).length >= 1);
      assert.strictEqual(screen.queryByText(/not evidence/), null);
      assert.strictEqual(document.body.textContent?.match(RESTRICTED), null);
    });

    it("flags an invalid run in the list and puts a red not-evidence banner above its numbers", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/benchmarks": () => [entry("run-bad-00001", INVALID)], "GET /v1/benchmarks/run-bad-00001": () => detail("run-bad-00001", INVALID, 2461) });
      renderWithClient(<BenchmarksPanel />);
      assert.ok(await screen.findByText("INVALID"));
      const banner = await screen.findByRole("alert");
      assert.match(banner.textContent ?? "", /not evidence/);
      assert.match(banner.textContent ?? "", /2461 of 9000/);
      assert.ok(screen.getByText("Environment manifest"), "numbers are only ever shown under the banner");
    });

    it("downloads raw CSV with the bearer token", async () => {
      await signInAs("auditor");
      stub = installFetch({
        "GET /v1/benchmarks": () => [entry("run-valid-0001", VALID)],
        "GET /v1/benchmarks/run-valid-0001": () => detail("run-valid-0001", VALID),
        "GET /v1/benchmarks/run-valid-0001/handshakes.csv": () => new Response("run,condition\n", { status: 200, headers: { "content-type": "text/csv" } }),
      });
      renderWithClient(<BenchmarksPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Download raw handshakes CSV" }));
      await waitFor(() => assert.strictEqual(stub!.callsTo("GET", "/v1/benchmarks/run-valid-0001/handshakes.csv").length, 1));
      assert.match(stub.callsTo("GET", "/v1/benchmarks/run-valid-0001/handshakes.csv")[0]?.headers["authorization"] ?? "", /^Bearer /);
    });

    it("explains how to publish a run when there are none", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/benchmarks": () => [] });
      renderWithClient(<BenchmarksPanel />);
      assert.ok(await screen.findByText("No benchmark run has been published"));
    });
  });

  describe("experiments", () => {
    const SCENARIOS = [
      { id: "unregistered-peer", title: "Unregistered peer", experiment: "B", description: "A peer whose certificate is not registered.", expected: "rejected-unknown-peer", requires: [] },
      { id: "partner-payment-hybrid", title: "Partner payment over hybrid TLS", experiment: "E2E", description: "A hybrid peer pays a customer account.", expected: "allowed-hybrid", requires: ["toAccountId"] },
    ];
    const RESULT = (id: string) => ({
      id,
      title: "t",
      experiment: "B",
      description: "d",
      expected: "rejected-unknown-peer",
      observed: "rejected-unknown-peer",
      passed: true,
      startedAt: "2026-11-01T10:00:00.000Z",
      durationMs: 42,
      detail: { connected: true, handshakeMs: 3.1, protocol: "TLSv1.3", cipher: null, offeredGroups: ["X25519MLKEM768", "X25519"], selectedGroup: "X25519MLKEM768", clientHelloBytes: 1457, serverKeyShareBytes: 1120, httpStatus: 403, peerSawDecision: "rejected-unknown-peer", transactionId: null, error: null },
      notes: [],
    });

    it("lets a security administrator run a scenario and shows expected versus observed", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/experiments/scenarios": () => SCENARIOS, "POST /v1/experiments/run": () => RESULT("unregistered-peer") });
      renderWithClient(<ExperimentsPanel />);
      await screen.findByText("Unregistered peer");
      assert.ok(screen.getAllByText("SIM").length >= 1);
      fireEvent.click(screen.getByRole("button", { name: "Run Unregistered peer" }));
      assert.ok(await screen.findByText("Passed"));
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/experiments/run")[0]?.body, { scenarioId: "unregistered-peer" });
      assert.ok(screen.getAllByText("Rejected - unknown peer").length >= 2, "expected and observed");
    });

    it("requires a valid account UUID and amount for payment scenarios and sends them as params", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/experiments/scenarios": () => SCENARIOS, "POST /v1/experiments/run": () => RESULT("partner-payment-hybrid") });
      renderWithClient(<ExperimentsPanel />);
      await screen.findByText("Partner payment over hybrid TLS");
      const run = screen.getByRole("button", { name: "Run Partner payment over hybrid TLS" });

      fireEvent.change(screen.getByLabelText(/Customer account to credit/), { target: { value: "acc_not_a_uuid" } });
      fireEvent.click(run);
      assert.ok(await screen.findByText(/Must be the UUID of a customer account/));
      assert.strictEqual(stub.callsTo("POST", "/v1/experiments/run").length, 0, "nothing is sent for invalid parameters");

      fireEvent.change(screen.getByLabelText(/Customer account to credit/), { target: { value: ACCOUNT } });
      fireEvent.change(screen.getByLabelText(/Amount \(minor units\)/), { target: { value: "0250" } });
      fireEvent.click(run);
      assert.ok(await screen.findByText(/no leading zero/));

      fireEvent.change(screen.getByLabelText(/Amount \(minor units\)/), { target: { value: "2500" } });
      fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: "e2e payment" } });
      fireEvent.click(run);
      await waitFor(() => assert.strictEqual(stub!.callsTo("POST", "/v1/experiments/run").length, 1));
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/experiments/run")[0]?.body, {
        scenarioId: "partner-payment-hybrid",
        params: { toAccountId: ACCOUNT, amountMinorUnits: "2500", reference: "e2e payment" },
      });
    });

    it("shows an auditor the scenarios read-only with the run buttons disabled", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/experiments/scenarios": () => SCENARIOS });
      renderWithClient(<ExperimentsPanel />);
      await screen.findByText("Unregistered peer");
      assert.strictEqual((screen.getByRole("button", { name: "Run Unregistered peer" }) as HTMLButtonElement).disabled, true);
      assert.ok(screen.getAllByText(/Read-only/).length >= 1);
    });

    it("explains an unavailable simulator when a run answers 503, and when the list itself does", async () => {
      await signInAs("security_admin");
      stub = installFetch({
        "GET /v1/experiments/scenarios": () => SCENARIOS,
        "POST /v1/experiments/run": () => apiError(503, "DEPENDENCY_UNAVAILABLE", "The peer simulator is not reachable."),
      });
      renderWithClient(<ExperimentsPanel />);
      await screen.findByText("Unregistered peer");
      fireEvent.click(screen.getByRole("button", { name: "Run Unregistered peer" }));
      assert.ok(await screen.findByText(/peer simulator is not configured or not reachable/));
      cleanup();
      stub.uninstall();

      stub = installFetch({ "GET /v1/experiments/scenarios": () => apiError(503, "DEPENDENCY_UNAVAILABLE", "The peer simulator is not configured (PEER_SIM_URL / PEER_SIM_TOKEN).") });
      renderWithClient(<ExperimentsPanel />);
      assert.ok(await screen.findByText(/peer simulator is not configured/));
    });
  });
});
