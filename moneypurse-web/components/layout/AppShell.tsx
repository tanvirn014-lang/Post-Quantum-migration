"use client";

import type { ReactNode } from "react";
import { useSession } from "../../hooks/useSession";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

/** Customer-facing shell. The greeting uses the signed-in identity, never a placeholder name. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header greeting="Welcome back" identity={user?.email ?? ""} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
