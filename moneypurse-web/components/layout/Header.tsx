import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { SmartSearch } from "../search/SmartSearch";

export interface HeaderProps {
  greeting: string;
  lowBalance: boolean;
}

/**
 * The alerts area below is still a plain placeholder - Task 18 replaces it with the real
 * component by editing this file directly, per that task's own Files section.
 */
export function Header({ greeting, lowBalance }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-subtle">
      <div>
        <p className="text-lg font-semibold text-primary">{greeting}</p>
        {lowBalance && <Badge tone="warning">Low balance</Badge>}
      </div>

      <div className="flex items-center gap-4">
        <SmartSearch />
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
