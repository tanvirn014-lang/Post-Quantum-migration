"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "../components/auth/AuthGate";
import { session } from "../lib/api/clients";
import { isApiRequestError } from "../lib/api/api-client";
import { restoreExternalSession, type CustomerAuthGateway } from "../lib/auth/customer-auth";
import { getSupabaseGateway } from "../lib/auth/supabase-gateway";
import { useSession } from "../hooks/useSession";

/** Restores a session from the refresh cookie once at start, and wipes cached data whenever the
 *  signed-in user changes, so one person data can never show up for the next. The gateway is a prop
 *  (defaulting to the configured one) so the startup sequence can be tested with a fake. */
export function SessionLifecycle({ client, gateway = getSupabaseGateway() }: { client: QueryClient; gateway?: CustomerAuthGateway | null }) {
  const { user } = useSession();
  const lastUserId = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Startup restore runs exactly once: establishing a session re-renders this component, and an
    // effect that re-ran on every render would re-adopt the Supabase token in a loop, flooding the
    // ledger (429s) and clearing the session on each failure. The ref guard also absorbs React's
    // development double-invoke. Prefer a surviving Supabase session; else the local refresh cookie.
    if (started.current) return;
    started.current = true;
    void (async () => {
      const restored = await restoreExternalSession(session, gateway);
      if (!restored) await session.restore();
    })();
  }, [gateway]);

  useEffect(() => {
    const id = user?.id ?? null;
    if (id !== lastUserId.current) {
      client.clear();
      lastUserId.current = id;
    }
  }, [user?.id, client]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            // Auth and permission errors will not fix themselves by retrying.
            retry: (count, error) => !(isApiRequestError(error) && [401, 403, 404].includes(error.status)) && count < 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <SessionLifecycle client={client} />
      <AuthGate>{children}</AuthGate>
    </QueryClientProvider>
  );
}
