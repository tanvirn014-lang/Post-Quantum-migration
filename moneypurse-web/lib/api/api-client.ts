/**
 * Small HTTP client shared by the ledger-service and security-service clients. It owns the
 * concerns every call has in common: bearer-token injection, the {error:{code,message,
 * requestId,details}} envelope, request ids for support/log correlation, and a single
 * transparent refresh-and-retry when the access token has expired.
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
}

/** What the client needs from whoever owns the session. */
export interface AuthProvider {
  getAccessToken(): string | null;
  /** Obtains a fresh access token (single-flight on the provider side). null = cannot refresh. */
  refreshAccessToken(): Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  auth: AuthProvider | null;
  /** Resolved on every call (not captured) so tests can swap globalThis.fetch. */
  fetchImpl?: () => typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  /** Send cookies (the refresh cookie). Only the auth endpoints need this. */
  credentials?: RequestCredentials;
  /** Set false for endpoints that must not carry (or retry with) a bearer token, e.g. login. */
  authenticated?: boolean;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]): string {
  const url = `${baseUrl}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Turns a Response into its JSON body or a typed ApiRequestError. 204 resolves undefined. */
export async function parseApiResponse<T>(res: Response): Promise<T> {
  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiRequestError("The server sent an unreadable response", "BAD_RESPONSE", res.status, requestId);
  }
  if (!res.ok) {
    const envelope = (json as { error?: { code?: string; message?: string; requestId?: string; details?: unknown } } | undefined)?.error;
    throw new ApiRequestError(
      envelope?.message ?? `Request failed with status ${res.status}`,
      envelope?.code ?? "REQUEST_FAILED",
      res.status,
      envelope?.requestId ?? requestId,
      envelope?.details,
    );
  }
  return json as T;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private async send(method: string, path: string, opts: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const doFetch = this.options.fetchImpl ? this.options.fetchImpl() : globalThis.fetch;
    try {
      return await doFetch(buildUrl(this.options.baseUrl, path, opts.query), {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.credentials ? { credentials: opts.credentials } : {}),
      });
    } catch {
      throw new ApiRequestError("Could not reach the server. Check your connection and try again.", "NETWORK_ERROR", 0);
    }
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const authenticated = opts.authenticated !== false && this.options.auth !== null;
    const auth = this.options.auth;
    let res = await this.send(method, path, opts, authenticated ? auth!.getAccessToken() : null);

    if (res.status === 401 && authenticated) {
      // Expired access token: refresh once (the provider coalesces concurrent refreshes) and retry once.
      const fresh = await auth!.refreshAccessToken();
      if (fresh) res = await this.send(method, path, opts, fresh);
    }
    return parseApiResponse<T>(res);
  }

  /**
   * Authenticated download of a file response (CSV, CycloneDX JSON). A plain link cannot carry the
   * bearer token, so the console fetches the bytes here and hands the Blob to the browser. Same
   * single refresh-and-retry as every other call; errors use the usual envelope.
   */
  async getBlob(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<{ blob: Blob; filename: string | null }> {
    const auth = this.options.auth;
    const authenticated = opts.authenticated !== false && auth !== null;
    let res = await this.send("GET", path, { ...opts, headers: { ...(opts.headers ?? {}), Accept: "*/*" } }, authenticated ? auth!.getAccessToken() : null);
    if (res.status === 401 && authenticated) {
      const fresh = await auth!.refreshAccessToken();
      if (fresh) res = await this.send("GET", path, { ...opts, headers: { ...(opts.headers ?? {}), Accept: "*/*" } }, fresh);
    }
    if (!res.ok) return parseApiResponse<never>(res);
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
    return { blob: await res.blob(), filename };
  }

  get<T>(path: string, opts?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("GET", path, opts);
  }
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("POST", path, { ...opts, ...(body !== undefined ? { body } : {}) });
  }
  patch<T>(path: string, body: unknown, opts?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T>(path: string, opts?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }
}
