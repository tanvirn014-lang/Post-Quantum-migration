import { SmartSearch } from "../search/SmartSearch";
import { AlertsDropdown } from "../alerts/AlertsDropdown";
import { UserMenu } from "../auth/UserMenu";

export interface HeaderProps {
  greeting: string;
  identity: string;
}

export function Header({ greeting, identity }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 border-b border-subtle">
      <div className="min-w-0">
        <p className="text-lg font-semibold text-primary">{greeting}</p>
        {identity && <p className="truncate text-xs text-muted">{identity}</p>}
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <SmartSearch />
        <AlertsDropdown />
        <UserMenu />
      </div>
    </header>
  );
}
