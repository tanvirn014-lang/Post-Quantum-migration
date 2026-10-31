// Only Overview exists. The rest are placeholders and say so, rather than looking clickable.
const NAV_ITEMS = [
  { label: "Overview", active: true },
  { label: "Accounts", active: false },
  { label: "Transactions", active: false },
  { label: "Analytics", active: false },
  { label: "Cards", active: false },
  { label: "Settings", active: false },
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-56 shrink-0 bg-surface-raised border-r border-subtle p-4 flex-col gap-1">
      <div className="px-2 py-3 text-lg font-semibold text-primary lowercase tracking-tight">moneypurse</div>
      <nav className="flex flex-col gap-1 mt-2" aria-label="Main">
        {NAV_ITEMS.map((item) =>
          item.active ? (
            <span key={item.label} aria-current="page" className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-overlay text-primary">
              {item.label}
            </span>
          ) : (
            <span
              key={item.label}
              aria-disabled="true"
              title="Planned - not implemented yet"
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted cursor-not-allowed"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
    </aside>
  );
}
