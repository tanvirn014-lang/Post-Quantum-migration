"use client";

import { useState, type FormEvent } from "react";
import { useAuthActions } from "../../hooks/useSession";
import { Button } from "../ui/Button";
import { Field, FormError, TextInput } from "../ui/Form";

/**
 * Credentials form. Failure messages come straight from the server and are deliberately
 * generic ("Invalid credentials") - the UI adds nothing that would reveal whether an email exists.
 */
export function LoginForm() {
  const { login } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // AuthGate sees the new session and navigates to the role landing page.
    } catch (err) {
      setError(err);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="Email">
        {(id) => <TextInput id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Password">
        {(id) => (
          <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" disabled={busy || email.length === 0 || password.length === 0}>
        {busy ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
