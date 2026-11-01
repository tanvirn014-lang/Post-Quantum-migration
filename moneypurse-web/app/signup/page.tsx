import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "../../components/auth/SignupForm";

export const metadata: Metadata = { title: "Create account - MoneyPurse" };

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-raised p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-primary lowercase tracking-tight">moneypurse</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Create your account.</p>
        <SignupForm />
        <p className="mt-6 text-xs text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-muted">
          Research prototype for a hybrid post-quantum migration architecture. It is not a real bank and holds no real money.
        </p>
      </div>
    </main>
  );
}
