import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ComponentStatusPanel } from "../../../components/security/ComponentStatusPanel.js";
import { OverviewPanel } from "../../../components/security/OverviewPanel.js";
import { PeersPanel } from "../../../components/security/PeersPanel.js";
import { apiError, installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { renderWithClient } from "../../helpers/render.js";
import { signInAs, signOut } from "../../helpers/session.js";

const PEER = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Partner Bank A",
  description: "",
  certSha256: "ab".repeat(32),
  profile: "hybrid-required",
  enabled: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const EMPTY_TELEMETRY = { sinceHours: 24, total: 0, byDecision: {}, byKeyExchange: {}, openAlerts: 0, handshakeMs: {} };

describe("security console", () => {
  let stub: InstalledFetch | undefined;
  afterEach(async () => {
    stub?.uninstall();
    cleanup();
    await signOut();
  });

  describe("peer registry permission gating", () => {
    it("lets a security administrator register, edit and delete peers", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/peers": () => [PEER] });
      renderWithClient(<PeersPanel />);
      await screen.findByText("Partner Bank A");
      assert.ok(screen.getByRole("button", { name: "Register peer" }));
      assert.ok(screen.getByRole("button", { name: "Delete Partner Bank A" }));
      assert.ok(screen.getByLabelText("Policy profile for Partner Bank A"));
      assert.strictEqual(screen.queryByText(/read-only/i), null);
    });

    it("shows an auditor the registry read-only: no register, delete or edit controls", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/peers": () => [PEER] });
      renderWithClient(<PeersPanel />);
      await screen.findByText("Partner Bank A");
      assert.strictEqual(screen.queryByRole("button", { name: "Register peer" }), null);
      assert.strictEqual(screen.queryByRole("button", { name: /^Delete/ }), null);
      assert.strictEqual(screen.queryByLabelText(/Policy profile for/), null);
      assert.ok(screen.getByText(/read-only/i));
      assert.ok(screen.getByText("Hybrid required"));
    });

    it("validates the fingerprint before enabling registration, and posts it normalized to lowercase hex", async () => {
      await signInAs("security_admin");
      stub = installFetch({
        "GET /v1/peers": () => [],
        "POST /v1/peers": () => json({ ...PEER, name: "New Peer" }, 201),
      });
      renderWithClient(<PeersPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Register peer" }));

      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Peer" } });
      fireEvent.change(screen.getByLabelText("Client certificate SHA-256 fingerprint"), { target: { value: "not-a-fingerprint" } });
      assert.ok(screen.getByText(/64 hex characters/));
      const formSubmit = screen.getAllByRole("button", { name: "Register peer" }).find((b) => (b as HTMLButtonElement).type === "submit") as HTMLButtonElement;
      assert.strictEqual(formSubmit.disabled, true);

      const colonForm = "AB".repeat(32).match(/../g)!.join(":");
      fireEvent.change(screen.getByLabelText("Client certificate SHA-256 fingerprint"), { target: { value: colonForm } });
      assert.strictEqual(formSubmit.disabled, false);
      fireEvent.click(formSubmit);
      await waitFor(() => assert.strictEqual(stub!.callsTo("POST", "/v1/peers").length, 1));
      assert.deepStrictEqual(stub.callsTo("POST", "/v1/peers")[0]?.body, {
        name: "New Peer",
        description: "",
        certSha256: "ab".repeat(32),
        profile: "hybrid-required",
        enabled: true,
      });
    });

    it("explains deny-by-default when no peer is registered", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/peers": () => [] });
      renderWithClient(<PeersPanel />);
      assert.ok(await screen.findByText(/rejected as an unknown peer/i));
    });

    it("shows the server's refusal if an unauthorized user somehow reaches the API", async () => {
      await signInAs("auditor");
      stub = installFetch({ "GET /v1/peers": () => apiError(403, "FORBIDDEN", "You do not have permission to perform this action") });
      renderWithClient(<PeersPanel />);
      assert.ok(await screen.findByText(/do not have permission/i));
    });
  });

  describe("implementation status", () => {
    it("renders LIVE, SIM and PLANNED labels with evidence and limitations", async () => {
      await signInAs("auditor");
      stub = installFetch({
        "GET /v1/status/components": () => [
          { id: "a", name: "Peer registry", status: "LIVE", summary: "s", evidence: ["security-service/tests/peers.test.ts"], limitations: ["Stores policy only."] },
          { id: "b", name: "HNDL simulator", status: "SIM", summary: "s", evidence: ["x.test.ts"], limitations: [] },
          { id: "c", name: "Hybrid TLS sidecar", status: "PLANNED", summary: "s", evidence: [], limitations: ["Certificates remain classical."] },
        ],
      });
      renderWithClient(<ComponentStatusPanel />);
      await screen.findByText("Peer registry");
      // Each status appears once in the legend and once on its component.
      assert.strictEqual(screen.getAllByText("LIVE").length, 2);
      assert.strictEqual(screen.getAllByText("SIM").length, 2);
      assert.strictEqual(screen.getAllByText("PLANNED").length, 2);
      assert.ok(screen.getByText("security-service/tests/peers.test.ts"));
      assert.ok(screen.getByText("Certificates remain classical."));
    });
  });

  describe("overview", () => {
    const overview = (overrides: object) => ({
      config: { version: 3, profile: "hybrid-preferred", groups: ["X25519MLKEM768", "X25519"], summary: "Hybrid is used with capable peers.", changedAt: "2026-11-01T00:00:00.000Z" },
      sidecars: [],
      peers: { total: 0, enabled: 0, hybridRequired: 0 },
      telemetry: EMPTY_TELEMETRY,
      ...overrides,
    });

    it("says no sidecar has reported instead of inventing live data", async () => {
      await signInAs("security_admin");
      stub = installFetch({ "GET /v1/overview": () => overview({}) });
      renderWithClient(<OverviewPanel />);
      assert.ok(await screen.findByText("No sidecar has reported yet"));
      assert.ok(screen.getByText("No connections recorded in this window"));
      assert.ok(screen.getByText("No timed handshakes yet"));
      assert.ok(screen.getByText("hybrid-preferred"));
    });

    it("shows a reporting sidecar, its sync state, and measured latency per key exchange", async () => {
      await signInAs("security_admin");
      stub = installFetch({
        "GET /v1/overview": () =>
          overview({
            sidecars: [
              {
                instanceId: "sidecar-1",
                startedAt: "2026-11-01T00:00:00.000Z",
                lastSeenAt: "2026-11-01T00:01:00.000Z",
                ageSeconds: 4,
                stale: false,
                appliedConfigVersion: 2,
                inSync: false,
                activeProfile: "hybrid-preferred",
                runtime: { openssl: "3.5.7" },
                listener: {},
                counters: {},
              },
            ],
            telemetry: {
              sinceHours: 24,
              total: 10,
              byDecision: { "allowed-hybrid": 8, "allowed-fallback": 2 },
              byKeyExchange: { hybrid: 8, classical: 2 },
              openAlerts: 2,
              handshakeMs: { hybrid: { count: 8, mean: 5, p50: 4.5, p95: 9, p99: 12 }, classical: { count: 2, mean: 2, p50: 2, p95: 3, p99: 3 } },
            },
          }),
      });
      renderWithClient(<OverviewPanel />);
      await screen.findByText("sidecar-1");
      assert.ok(screen.getByText("Config out of sync"));
      assert.ok(screen.getByText("3.5.7"));
      assert.ok(screen.getByText("Allowed - classical fallback"));
      assert.ok(screen.getByText("4.50 ms"));
      assert.ok(screen.getByText(/not representative of production network latency/i));
    });

    it("flags a stale sidecar", async () => {
      await signInAs("auditor");
      stub = installFetch({
        "GET /v1/overview": () =>
          overview({
            sidecars: [
              { instanceId: "s", startedAt: "2026-11-01T00:00:00.000Z", lastSeenAt: "2026-11-01T00:00:00.000Z", ageSeconds: 300, stale: true, appliedConfigVersion: 3, inSync: true, activeProfile: "hybrid-preferred", runtime: {}, listener: {}, counters: {} },
            ],
          }),
      });
      renderWithClient(<OverviewPanel />);
      assert.ok(await screen.findByText("Stale"));
    });
  });
});
