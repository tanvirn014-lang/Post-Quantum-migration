"use client";

import { useState, type FormEvent } from "react";
import { useAuthActions } from "../../hooks/useSession";
import { Button } from "../ui/Button";
import { Field, FormError, TextInput } from "../ui/Form";

export function ChangePasswordForm() {
  const { changePassword, logout } = useAuthActions();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // The backend returns a fresh session with the flag cleared; AuthGate then routes onward.
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="Current password">
        {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="New password" hint="At least 12 characters. A long passphrase is better than a complex short one.">
        {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <Field label="Confirm new password" error={mismatch ? "The passwords do not match." : undefined}>
        {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <FormError error={error} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
        <Button type="submit" variant="primary" disabled={busy || current.length === 0 || next.length === 0 || mismatch || confirm.length === 0}>
          {busy ? "Saving..." : "Change password"}
        </Button>
      </div>
    </form>
  );
}
