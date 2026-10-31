export interface RecordedCall {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response> | unknown;

/** A JSON response with the status given. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message, requestId: "req-test-1234", ...extra } }, status, { "x-request-id": "req-test-1234" });
}

export interface InstalledFetch {
  calls: RecordedCall[];
  callsTo(method: string, path: string): RecordedCall[];
  uninstall(): void;
}

/**
 * Replaces globalThis.fetch with a router keyed by "METHOD /path" (query string ignored).
 * A handler may return a Response or any plain value (sent as 200 JSON). Unrouted requests
 * answer 404 in the real error envelope, so a missing route fails loudly instead of hanging.
 */
export function installFetch(routes: Record<string, Handler>): InstalledFetch {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const call: RecordedCall = {
      method,
      path: parsed.pathname,
      url,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
    };
    calls.push(call);
    const handler = routes[`${method} ${parsed.pathname}`];
    if (!handler) return apiError(404, "NOT_FOUND", `No test route for ${method} ${parsed.pathname}`);
    const result = await handler(call);
    return result instanceof Response ? result : json(result);
  }) as typeof fetch;

  return {
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    uninstall: () => {
      globalThis.fetch = original;
    },
  };
}
