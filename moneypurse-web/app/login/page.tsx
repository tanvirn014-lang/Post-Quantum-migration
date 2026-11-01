import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "../../components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in - MoneyPurse" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-surface-base p-4">
      <div className="w-full max-w-sm rounded-xl border border-subtle bg-surface-raised p-7 shadow-e4">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-on-dark text-sm font-semibold">m</span>
          <span className="text-lg font-semibold text-primary lowercase tracking-tight">moneypurse</span>
        </div>
        <h1 className="text-lg font-semibold text-primary">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-secondary">Welcome back. Enter your details to continue.</p>
        <LoginForm />
        <p className="mt-6 text-xs text-muted">
          New here?{" "}
          <Link href="/signup" className="text-primary underline">
            Create an account
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
