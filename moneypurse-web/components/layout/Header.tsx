import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { SmartSearch } from "../search/SmartSearch";
import { AlertsDropdown } from "../alerts/AlertsDropdown";

export interface HeaderProps {
  greeting: string;
  lowBalance: boolean;
}

export function Header({ greeting, lowBalance }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-subtle">
      <div>
        <p className="text-lg font-semibold text-primary">{greeting}</p>
        {lowBalance && <Badge tone="warning">Low balance</Badge>}
      </div>

      <div className="flex items-center gap-4">
        <SmartSearch />
        <AlertsDropdown />
        <Avatar initials="MP" />
      </div>
    </header>
  );
}
