import type { CustomerAuthGateway } from "./customer-auth";
import type { SignupGateway, SignupSession } from "./signup-flow";
import { getSupabaseClient } from "./supabase-client";

/**
 * Wraps the Supabase auth client as the two gateways the app uses: SignupGateway for the dual-step
 * OTP sign-up, and CustomerAuthGateway for login/refresh/restore. Only the subset of the Supabase
 * API below is used, which keeps the gateway testable against a small fake.
 */

interface AuthSession {
  access_token: string;
  refresh_token: string | null;
}
interface SessionResult {
  data: { session: AuthSession | null };
  error: { message: string } | null;
}
interface PlainResult {
  error: { message: string } | null;
}

export interface SupabaseAuthApi {
  signUp(credentials: { email: string; password: string; options?: { data?: Record<string, unknown> } }): Promise<SessionResult>;
  verifyOtp(params: { email: string; token: string; type: "signup" }): Promise<SessionResult>;
  resend(params: { type: "signup"; email: string }): Promise<PlainResult>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<SessionResult>;
  refreshSession(): Promise<SessionResult>;
  signOut(): Promise<PlainResult>;
  getSession(): Promise<{ data: { session: AuthSession | null } }>;
}

export type SupabaseGateway = SignupGateway & CustomerAuthGateway;

function toSession(session: AuthSession): SignupSession {
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

export function createSupabaseGateway(auth: SupabaseAuthApi): SupabaseGateway {
  return {
    async requestSignup({ email, password, fullName }) {
      const { error } = await auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw new Error(error.message);
    },
    async verifyCode({ email, code }) {
      const { data, error } = await auth.verifyOtp({ email, token: code, type: "signup" });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Verification did not return a session.");
      return toSession(data.session);
    },
    async resendCode(email) {
      const { error } = await auth.resend({ type: "signup", email });
      if (error) throw new Error(error.message);
    },
    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Sign-in did not return a session.");
      return toSession(data.session);
    },
    async refreshToken() {
      const { data, error } = await auth.refreshSession();
      if (error || !data.session) return null;
      return data.session.access_token;
    },
    async signOut() {
      await auth.signOut();
    },
    async getInitialToken() {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
  };
}

/** The gateway for the configured project, or null when Supabase env is not set. */
export function getSupabaseGateway(): SupabaseGateway | null {
  const client = getSupabaseClient();
  if (!client) return null;
  // The real client's auth exposes a superset of SupabaseAuthApi (richer, overloaded signatures);
  // narrow it at this single boundary, the way the backend narrows node:crypto's ML-KEM surface.
  return createSupabaseGateway(client.auth as unknown as SupabaseAuthApi);
}
