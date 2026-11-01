"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { session } from "../../lib/api/clients";
import { completeSignup } from "../../lib/auth/customer-auth";
import { SignupController, type SignupState } from "../../lib/auth/signup-flow";
import { getSupabaseGateway, type SupabaseGateway } from "../../lib/auth/supabase-gateway";
import { Button } from "../ui/Button";
import { Field, TextInput } from "../ui/Form";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
      {error}
    </p>
  );
}

const NO_CONTROLLER: SignupState = { step: "collecting", email: "", fullName: "", error: null, session: null };

/**
 * The dual-step, OTP-confirmed sign-up. Step 1 collects name/email/password and asks Supabase to
 * email a 6-digit code; step 2 verifies the code and signs the new customer in. The flow logic and
 * validation live in SignupController; this component renders its state and forwards events. The
 * gateway is injectable so the form is testable without the Supabase SDK.
 */
export function SignupForm({ gateway: gatewayProp }: { gateway?: SupabaseGateway | null }) {
  const [gateway] = useState<SupabaseGateway | null>(() => (gatewayProp !== undefined ? gatewayProp : getSupabaseGateway()));
  const [controller] = useState(() => (gateway ? new SignupController(gateway) : null));
  const state = useSyncExternalStore(
    controller ? controller.subscribe : () => () => {},
    controller ? controller.getState : () => NO_CONTROLLER,
    controller ? controller.getState : () => NO_CONTROLLER,
  );

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const adopted = useRef(false);

  useEffect(() => {
    if (state.step === "done" && state.session && !adopted.current) {
      adopted.current = true;
      // AuthGate sees the new session and routes the customer to the dashboard.
      void completeSignup(session, gateway, state.session);
    }
  }, [state.step, state.session, gateway]);

  if (!gateway || !controller) {
    return (
      <p className="text-sm text-muted" role="status">
        Account sign-up is not configured in this deployment. Please use an existing account to sign in.
      </p>
    );
  }

  const sending = state.step === "sending-code";
  const verifying = state.step === "verifying";
  const onCodeStep = state.step === "awaiting-code" || state.step === "verifying";

  async function onSubmitDetails(e: FormEvent) {
    e.preventDefault();
    await controller!.submitDetails({ fullName, email, password });
  }
  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    await controller!.submitCode(code);
  }

  if (state.step === "done") {
    return (
      <p className="text-sm text-muted" role="status">
        Account created. Signing you in…
      </p>
    );
  }

  if (onCodeStep) {
    return (
      <form onSubmit={onSubmitCode} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          We emailed a 6-digit code to <span className="text-primary">{state.email}</span>. Enter it to finish creating your account.
        </p>
        <Field label="Verification code">
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <ErrorText error={state.error} />
        <Button type="submit" variant="primary" disabled={verifying || code.length === 0}>
          {verifying ? "Verifying…" : "Verify and continue"}
        </Button>
        <button type="button" className="text-xs text-muted underline" onClick={() => void controller!.resend()}>
          Resend code
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitDetails} className="flex flex-col gap-4" noValidate>
      <Field label="Full name">
        {(id) => <TextInput id={id} autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />}
      </Field>
      <Field label="Email">
        {(id) => <TextInput id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        {(id) => (
          <TextInput id={id} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <ErrorText error={state.error} />
      <Button type="submit" variant="primary" disabled={sending || email.length === 0 || password.length === 0 || fullName.length === 0}>
        {sending ? "Sending code…" : "Create account"}
      </Button>
    </form>
  );
}
