/**
 * The dual-step, OTP-confirmed sign-up as a framework-agnostic state machine. It owns validation,
 * the step transitions and error mapping; the React form only renders state and forwards events,
 * and the Supabase calls live behind an injected gateway. This split keeps the whole flow testable
 * offline, with no Supabase network and no DOM.
 */

export interface SignupSession {
  accessToken: string;
  refreshToken: string | null;
}

export interface SignupGateway {
  /** Step 1: create the account and trigger the emailed one-time code. */
  requestSignup(input: { email: string; password: string; fullName: string }): Promise<void>;
  /** Step 2: verify the 6-digit code; resolves with the established session. */
  verifyCode(input: { email: string; code: string }): Promise<SignupSession>;
  /** Re-send the code to the same email. */
  resendCode(email: string): Promise<void>;
}

export type SignupStep = "collecting" | "sending-code" | "awaiting-code" | "verifying" | "done";

export interface SignupState {
  step: SignupStep;
  email: string;
  fullName: string;
  error: string | null;
  session: SignupSession | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
const MIN_PASSWORD = 8;

function messageFromError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

export class SignupController {
  private state: SignupState = { step: "collecting", email: "", fullName: "", error: null, session: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly gateway: SignupGateway) {}

  getState = (): SignupState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SignupState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async submitDetails(input: { fullName: string; email: string; password: string }): Promise<void> {
    const fullName = input.fullName.trim();
    const email = input.email.trim().toLowerCase();
    if (fullName.length === 0) return this.set({ error: "Enter your name." });
    if (!EMAIL_RE.test(email)) return this.set({ error: "Enter a valid email address." });
    if (input.password.length < MIN_PASSWORD) return this.set({ error: `Use a password of at least ${MIN_PASSWORD} characters.` });

    this.set({ step: "sending-code", email, fullName, error: null });
    try {
      await this.gateway.requestSignup({ email, password: input.password, fullName });
      this.set({ step: "awaiting-code" });
    } catch (err) {
      this.set({ step: "collecting", error: messageFromError(err) });
    }
  }

  async submitCode(code: string): Promise<void> {
    const trimmed = code.trim();
    if (!CODE_RE.test(trimmed)) return this.set({ error: "Enter the 6-digit code from your email." });

    this.set({ step: "verifying", error: null });
    try {
      const session = await this.gateway.verifyCode({ email: this.state.email, code: trimmed });
      this.set({ step: "done", session });
    } catch (err) {
      this.set({ step: "awaiting-code", error: messageFromError(err), session: null });
    }
  }

  async resend(): Promise<void> {
    try {
      await this.gateway.resendCode(this.state.email);
      this.set({ error: null });
    } catch (err) {
      this.set({ error: messageFromError(err) });
    }
  }
}
