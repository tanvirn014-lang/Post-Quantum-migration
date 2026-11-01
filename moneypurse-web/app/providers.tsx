"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "../components/auth/AuthGate";
import { session } from "../lib/api/clients";
import { isApiRequestError } from "../lib/api/api-client";
import { restoreExternalSession } from "../lib/auth/customer-auth";
import { getSupabaseGateway } from "../lib/auth/supabase-gateway";
import { useAuthActions, useSession } from "../hooks/useSession";

/** Restores a session from the refresh cookie once at start, and wipes cached data whenever the
 *  signed-in user changes, so one person data can never show up for the next. */
function SessionLifecycle({ client }: { client: QueryClient }) {
  const { restore } = useAuthActions();
  const { user } = useSession();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    // Prefer a surviving Supabase session; otherwise restore from the local refresh cookie.
    void (async () => {
      const restored = await restoreExternalSession(session, getSupabaseGateway());
      if (!restored) await restore();
    })();
  }, [restore]);

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
