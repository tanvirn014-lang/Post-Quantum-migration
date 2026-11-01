import { SmartSearch } from "../search/SmartSearch";
import { AlertsDropdown } from "../alerts/AlertsDropdown";
import { UserMenu } from "../auth/UserMenu";

export interface HeaderProps {
  greeting: string;
  identity: string;
}

export function Header({ greeting, identity }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 bg-surface-base/85 px-4 py-4 backdrop-blur-sm sm:px-6 lg:px-8">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-primary">{greeting}</h1>
        {identity && <p className="truncate text-xs text-secondary">{identity}</p>}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <SmartSearch />
        <AlertsDropdown />
        <UserMenu />
      </div>
    </header>
  );
}
