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
    <aside className="w-56 shrink-0 bg-surface-raised border-r border-subtle p-4 flex flex-col gap-1">
      <div className="px-2 py-3 text-lg font-semibold text-primary lowercase tracking-tight">moneypurse</div>
      <nav className="flex flex-col gap-1 mt-2">
        {NAV_ITEMS.map((item) =>
          item.active ? (
            <span
              key={item.label}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-overlay text-primary"
            >
              {item.label}
            </span>
          ) : (
            <a
              key={item.label}
              href="#"
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted cursor-not-allowed"
            >
              {item.label}
            </a>
          ),
        )}
      </nav>
    </aside>
  );
}
