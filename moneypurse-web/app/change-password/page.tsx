import type { Metadata } from "next";
import { ChangePasswordForm } from "../../components/auth/ChangePasswordForm";

export const metadata: Metadata = { title: "Change password - MoneyPurse" };

export default function ChangePasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-surface-base p-4">
      <div className="w-full max-w-sm rounded-xl border border-subtle bg-surface-raised p-7 shadow-e4">
        <h1 className="text-lg font-semibold text-primary">Choose a new password</h1>
        <p className="mt-1 mb-6 text-sm text-secondary">Your password was set by someone else, so you need to replace it before you can continue.</p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
