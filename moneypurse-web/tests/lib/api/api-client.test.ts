import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiRequestError, type AuthProvider } from "../../../lib/api/api-client.js";
import { apiError, installFetch, json, noContent, type InstalledFetch } from "../../helpers/fetch-mock.js";

class FakeAuth implements AuthProvider {
  refreshCalls = 0;
  constructor(
    public token: string | null,
    private readonly next: string | null = "fresh-token",
  ) {}
  getAccessToken() {
    return this.token;
  }
  async refreshAccessToken() {
    this.refreshCalls++;
    // Simulates the provider's single-flight: concurrent callers share one network round trip.
    await new Promise((r) => setTimeout(r, 5));
    if (this.next) this.token = this.next;
    return this.next;
  }
}

describe("ApiClient", () => {
  let stub: InstalledFetch | undefined;
  afterEach(() => stub?.uninstall());

  const client = (auth: AuthProvider | null) => new ApiClient({ baseUrl: "http://api.test", auth });

  it("sends the bearer token and JSON content type, and builds the query string without undefined values", async () => {
    stub = installFetch({ "GET /things": () => ({ ok: true }) });
    const auth = new FakeAuth("tok-1");
    await client(auth).get("/things", { query: { limit: 5, before: undefined, flag: true } });
    const [call] = stub.calls;
    assert.strictEqual(call?.headers["authorization"], "Bearer tok-1");
    assert.strictEqual(call?.url, "http://api.test/things?limit=5&flag=true");
  });

  it("serializes a body as JSON with a content type, and omits Authorization when unauthenticated", async () => {
    stub = installFetch({ "POST /login": () => ({ ok: true }) });
    await client(new FakeAuth("tok-1")).post("/login", { a: 1 }, { authenticated: false });
    const [call] = stub.calls;
    assert.strictEqual(call?.headers["content-type"], "application/json");
    assert.deepStrictEqual(call?.body, { a: 1 });
    assert.strictEqual(call?.headers["authorization"], undefined);
  });

  it("resolves undefined for 204 and returns parsed JSON otherwise", async () => {
    stub = installFetch({ "DELETE /x": () => noContent(), "GET /y": () => ({ n: 1 }) });
    assert.strictEqual(await client(null).delete("/x"), undefined);
    assert.deepStrictEqual(await client(null).get("/y"), { n: 1 });
  });

  it("turns the error envelope into an ApiRequestError carrying code, status, request id and details", async () => {
    stub = installFetch({
      "POST /w": () => apiError(400, "WEAK_PASSWORD", "Password does not meet the policy", { details: { problems: ["too short"] } }),
    });
    await assert.rejects(
      () => client(null).post("/w", {}),
      (err: unknown) => {
        assert.ok(err instanceof ApiRequestError);
        assert.strictEqual(err.code, "WEAK_PASSWORD");
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.requestId, "req-test-1234");
        assert.deepStrictEqual(err.details, { problems: ["too short"] });
        assert.match(err.message, /policy/);
        return true;
      },
    );
  });

  it("reports an unreadable error body without leaking it", async () => {
    stub = installFetch({ "GET /broken": () => new Response("<html>proxy error</html>", { status: 502 }) });
    await assert.rejects(() => client(null).get("/broken"), (err: unknown) => err instanceof ApiRequestError && err.code === "BAD_RESPONSE" && err.status === 502);
  });

  it("maps a network failure to a friendly NETWORK_ERROR", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      await assert.rejects(() => client(null).get("/x"), (err: unknown) => err instanceof ApiRequestError && err.code === "NETWORK_ERROR" && err.status === 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  describe("401 handling", () => {
    it("refreshes once and retries the request with the new token", async () => {
      let attempts = 0;
      stub = installFetch({
        "GET /secure": (call) => {
          attempts++;
          return call.headers["authorization"] === "Bearer fresh-token" ? { ok: true } : apiError(401, "INVALID_TOKEN", "expired");
        },
      });
      const auth = new FakeAuth("stale-token");
      assert.deepStrictEqual(await client(auth).get("/secure"), { ok: true });
      assert.strictEqual(attempts, 2);
      assert.strictEqual(auth.refreshCalls, 1);
    });

    it("does not loop: a second 401 after refreshing is surfaced", async () => {
      stub = installFetch({ "GET /secure": () => apiError(401, "INVALID_TOKEN", "still no") });
      const auth = new FakeAuth("stale-token");
      await assert.rejects(() => client(auth).get("/secure"), (err: unknown) => err instanceof ApiRequestError && err.status === 401);
      assert.strictEqual(stub.callsTo("GET", "/secure").length, 2);
      assert.strictEqual(auth.refreshCalls, 1);
    });

    it("surfaces the 401 without retrying when the session cannot be refreshed", async () => {
      stub = installFetch({ "GET /secure": () => apiError(401, "INVALID_TOKEN", "expired") });
      const auth = new FakeAuth("stale-token", null);
      await assert.rejects(() => client(auth).get("/secure"), (err: unknown) => err instanceof ApiRequestError && err.code === "INVALID_TOKEN");
      assert.strictEqual(stub.callsTo("GET", "/secure").length, 1);
    });

    it("never refreshes for an unauthenticated call such as login (a bad password is not an expired token)", async () => {
      stub = installFetch({ "POST /login": () => apiError(401, "INVALID_CREDENTIALS", "Invalid credentials") });
      const auth = new FakeAuth("tok");
      await assert.rejects(() => client(auth).post("/login", {}, { authenticated: false }), (err: unknown) => err instanceof ApiRequestError && err.code === "INVALID_CREDENTIALS");
      assert.strictEqual(auth.refreshCalls, 0);
    });

    it("does not treat 403 as a reason to refresh", async () => {
      stub = installFetch({ "GET /forbidden": () => apiError(403, "FORBIDDEN", "no") });
      const auth = new FakeAuth("tok");
      await assert.rejects(() => client(auth).get("/forbidden"), (err: unknown) => err instanceof ApiRequestError && err.status === 403);
      assert.strictEqual(auth.refreshCalls, 0);
    });
  });

  it("works without any auth provider (public endpoints)", async () => {
    stub = installFetch({ "GET /public": () => json({ ok: 1 }) });
    assert.deepStrictEqual(await client(null).get("/public"), { ok: 1 });
    assert.strictEqual(stub.calls[0]?.headers["authorization"], undefined);
  });
});

describe("ApiClient.getBlob (authenticated file download)", () => {
  let stub: InstalledFetch | undefined;
  afterEach(() => stub?.uninstall());
  const client = (auth: AuthProvider | null) => new ApiClient({ baseUrl: "http://api.test", auth });

  it("sends the bearer token, returns the bytes and reads the filename from content-disposition", async () => {
    stub = installFetch({
      "GET /file.csv": () => new Response("a,b\n1,2\n", { status: 200, headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="run-handshakes.csv"' } }),
    });
    const { blob, filename } = await client(new FakeAuth("tok-1")).getBlob("/file.csv");
    assert.strictEqual(stub.calls[0]?.headers["authorization"], "Bearer tok-1");
    assert.strictEqual(await blob.text(), "a,b\n1,2\n");
    assert.strictEqual(filename, "run-handshakes.csv");
  });

  it("refreshes once on 401 and retries, like every other call", async () => {
    let first = true;
    stub = installFetch({
      "GET /file": () => {
        if (first) {
          first = false;
          return apiError(401, "INVALID_TOKEN", "expired");
        }
        return new Response("ok");
      },
    });
    const auth = new FakeAuth("old");
    const { blob } = await client(auth).getBlob("/file");
    assert.strictEqual(auth.refreshCalls, 1);
    assert.strictEqual(await blob.text(), "ok");
    assert.strictEqual(stub.calls[1]?.headers["authorization"], "Bearer fresh-token");
  });

  it("turns an error response into an ApiRequestError instead of returning its body as a file", async () => {
    stub = installFetch({ "GET /missing": () => apiError(404, "NOT_FOUND", "Benchmark run was not found") });
    await assert.rejects(
      () => client(new FakeAuth("t")).getBlob("/missing"),
      (err: unknown) => err instanceof ApiRequestError && err.status === 404 && err.code === "NOT_FOUND",
    );
  });
});
