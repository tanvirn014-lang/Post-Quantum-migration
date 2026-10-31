"use client";

import { Button } from "../components/ui/Button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div role="alert" className="max-w-md rounded-xl bg-surface-raised p-6 text-center">
        <h1 className="text-lg font-semibold text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
        <Button className="mt-4" variant="primary" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
