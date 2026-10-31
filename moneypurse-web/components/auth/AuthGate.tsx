"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "../../hooks/useSession";
import { redirectFor } from "../../lib/auth/routing";

export function FullPageSpinner() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-subtle border-t-accent" />
    </div>
  );
}

/**
 * Wraps every route. While the session is resolving, or while a redirect is pending, it renders
 * only a spinner - protected content never flashes for a signed-out or wrong-role user. All
 * routing decisions live in lib/auth/routing.ts (pure, unit-tested); this just applies them.
 * Hiding a page here is a convenience: the APIs enforce access independently.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const target = redirectFor(pathname, session);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (session.status === "loading" || target) return <FullPageSpinner />;
  return <>{children}</>;
}
