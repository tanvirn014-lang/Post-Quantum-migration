import { Icon, type IconName } from "../ui/Icon";

// Only Overview exists. The rest are planned and are shown as such — present but clearly not
// clickable — rather than looking like working links.
const NAV_ITEMS: { label: string; icon: IconName; active: boolean }[] = [
  { label: "Overview", icon: "overview", active: true },
  { label: "Accounts", icon: "accounts", active: false },
  { label: "Transactions", icon: "transactions", active: false },
  { label: "Analytics", icon: "analytics", active: false },
  { label: "Cards", icon: "cards", active: false },
  { label: "Settings", icon: "settings", active: false },
];

/** A floating navigation rail: an elevated, opaque surface inset from the canvas edge. The active
 *  item carries the reserved accent (the only accent in the rail); planned items are quiet and
 *  non-interactive. */
export function Sidebar() {
  return (
    <aside className="hidden md:block w-60 shrink-0 p-4">
      <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col gap-1 rounded-xl border border-subtle bg-surface-raised p-3 shadow-e3">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-on-dark text-sm font-semibold">m</span>
          <span className="text-base font-semibold text-primary lowercase tracking-tight">moneypurse</span>
        </div>

        <nav className="mt-2 flex flex-col gap-1" aria-label="Main">
          {NAV_ITEMS.map((item) =>
            item.active ? (
              <span
                key={item.label}
                aria-current="page"
                className="flex items-center gap-3 rounded-md bg-accent-soft px-3 py-2 text-sm font-medium text-accent"
              >
                <Icon name={item.icon} />
                {item.label}
              </span>
            ) : (
              <span
                key={item.label}
                aria-disabled="true"
                title="Planned — not implemented yet"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted/80 cursor-not-allowed"
              >
                <Icon name={item.icon} />
                {item.label}
                <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-muted/60">Soon</span>
              </span>
            ),
          )}
        </nav>

        <p className="mt-auto px-2 pb-1 text-[11px] leading-snug text-muted/70">
          Research prototype. Not a real bank; holds no real money.
        </p>
      </div>
    </aside>
  );
}
