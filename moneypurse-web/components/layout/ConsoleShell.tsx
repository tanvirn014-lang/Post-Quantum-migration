"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../../hooks/useSession";
import { UserMenu } from "../auth/UserMenu";

export interface NavItem {
  href: string;
  label: string;
}

/** The research-prototype scope statement. Shown on every security-console page, always. */
export function PrototypeNotice() {
  return (
    <p className="rounded-lg border border-subtle bg-surface-raised px-4 py-2.5 text-xs text-muted">
      Hybrid key establishment protects only connections that negotiated X25519MLKEM768. Certificates remain classical. This is a research prototype.
    </p>
  );
}

/** Shell for staff areas (security console, operations): left nav on desktop, top nav on small screens. */
export function ConsoleShell({ title, nav, children, notice = false }: { title: string; nav: NavItem[]; children: ReactNode; notice?: boolean }) {
  const pathname = usePathname();
  const { user } = useSession();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-subtle bg-surface-raised p-3 md:w-56 md:border-b-0 md:border-r md:p-4">
        <div className="px-2 py-2 text-lg font-semibold lowercase tracking-tight text-primary">{title}</div>
        <nav aria-label={`${title} sections`} className="mt-1 flex gap-1 overflow-x-auto md:mt-2 md:flex-col">
          {nav.map((item) => {
            const active = item.href === nav[0]?.href ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-accent-soft text-accent" : "text-secondary hover:bg-surface-overlay hover:text-primary"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-3 sm:px-6">
          <p className="truncate text-sm text-muted">{user?.email}</p>
          <UserMenu />
        </header>
        <main className="flex-1 space-y-5 p-4 sm:p-6">
          {notice && <PrototypeNotice />}
          {children}
        </main>
      </div>
    </div>
  );
}
