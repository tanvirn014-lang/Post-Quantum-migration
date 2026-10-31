import type { Metadata } from "next";
import { ChangePasswordForm } from "../../components/auth/ChangePasswordForm";

export const metadata: Metadata = { title: "Change password - MoneyPurse" };

export default function ChangePasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-raised p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-primary">Choose a new password</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Your password was set by someone else, so you need to replace it before you can continue.</p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
