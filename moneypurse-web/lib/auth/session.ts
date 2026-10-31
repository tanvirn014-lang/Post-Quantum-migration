import { ApiRequestError, parseApiResponse, type AuthProvider } from "../api/api-client";

export type Role = "customer" | "operator" | "security_admin" | "auditor";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  mustChangePassword: boolean;
}

export type SessionStatus = "loading" | "anonymous" | "authenticated";

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Ledger-service permissions for the user's role, from GET /auth/me. UI hint only. */
  permissions: readonly string[];
}

interface SessionBody {
  accessToken: string;
  user: SessionUser;
}

interface MeBody {
  user: SessionUser;
  permissions: string[];
}

export interface SessionManagerOptions {
  ledgerBaseUrl: string;
  fetchImpl?: () => typeof fetch;
}

const LOADING: SessionState = { status: "loading", user: null, permissions: [] };
const ANONYMOUS: SessionState = { status: "anonymous", user: null, permissions: [] };

/**
 * Owns the browser-side session. The access token lives only in this object's memory - never
 * in localStorage/sessionStorage, so an XSS-readable store never holds a bearer credential. The
 * long-lived refresh token is an HttpOnly cookie the browser sends only to the /auth endpoints
 * (hence credentials:"include" on those calls and nowhere else).
 */
export class SessionManager implements AuthProvider {
  private state: SessionState = LOADING;
  private accessToken: string | null = null;
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<string | null> | null = null;
  private restoring: Promise<void> | null = null;

  constructor(private readonly options: SessionManagerOptions) {}

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }

  private async authFetch<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
    const doFetch = this.options.fetchImpl ? this.options.fetchImpl() : globalThis.fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.options.ledgerBaseUrl}${path}`, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiRequestError("Could not reach the server. Check your connection and try again.", "NETWORK_ERROR", 0);
    }
    return parseApiResponse<T>(res);
  }

  private async establish(token: string): Promise<void> {
    this.accessToken = token;
    const me = await this.authFetch<MeBody>("GET", "/auth/me", undefined, token);
    this.set({ status: "authenticated", user: me.user, permissions: me.permissions });
  }

  private clear(): void {
    this.accessToken = null;
    this.set(ANONYMOUS);
  }

  /** Called once at app start: turns a surviving refresh cookie back into a session, silently. */
  restore(): Promise<void> {
    if (!this.restoring) {
      this.restoring = (async () => {
        const token = await this.refreshAccessToken();
        if (token) {
          try {
            await this.establish(token);
          } catch {
            this.clear();
          }
        } else if (this.state.status === "loading") {
          this.set(ANONYMOUS);
        }
      })();
    }
    return this.restoring;
  }

  async login(email: string, password: string): Promise<SessionUser> {
    const body = await this.authFetch<SessionBody>("POST", "/auth/login", { email, password });
    await this.establish(body.accessToken);
    return this.state.user!;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<SessionUser> {
    const body = await this.authFetch<SessionBody>("POST", "/auth/change-password", { currentPassword, newPassword }, this.accessToken);
    await this.establish(body.accessToken);
    return this.state.user!;
  }

  async logout(): Promise<void> {
    try {
      await this.authFetch<void>("POST", "/auth/logout");
    } finally {
      // Local sign-out must succeed even if the server cannot be reached.
      this.clear();
    }
  }

  /**
   * Single-flight: any number of requests that hit an expired token at once share one
   * POST /auth/refresh. Refresh tokens rotate and a reused one revokes the whole session, so two
   * concurrent refreshes would sign the user out.
   */
  refreshAccessToken(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const body = await this.authFetch<SessionBody>("POST", "/auth/refresh");
          this.accessToken = body.accessToken;
          return body.accessToken;
        } catch (err) {
          // A definitive rejection ends the session; a network blip keeps it so the user can retry.
          if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) this.clear();
          return null;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }
}
