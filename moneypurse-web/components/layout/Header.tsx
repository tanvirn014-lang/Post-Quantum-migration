import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";

export interface HeaderProps {
  greeting: string;
  lowBalance: boolean;
}

/**
 * The search and alerts areas below are plain placeholders - Task 17 (Smart Search) and
 * Task 18 (Alerts) replace them with the real components by editing this file directly,
 * not by passing props into it, per those tasks' own Files sections.
 */
export function Header({ greeting, lowBalance }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-subtle">
      <div>
        <p className="text-lg font-semibold text-primary">{greeting}</p>
        {lowBalance && <Badge tone="warning">Low balance</Badge>}
      </div>

      <div className="flex items-center gap-4">
        <div
          data-slot="smart-search"
          className="w-64 rounded-lg bg-surface-overlay px-3 py-1.5 text-sm text-muted"
        >
          Search...
        </div>
        <button
          type="button"
          data-slot="alerts"
          aria-label="Alerts"
          className="h-9 w-9 flex items-center justify-center rounded-full bg-surface-overlay text-muted hover:text-primary"
        >
          🔔
        </button>
        <Avatar initials="MP" />
      </div>
    </header>
  );
}
