"use client";

import { useAuthActions, useSession } from "../../hooks/useSession";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dropdown } from "../ui/Dropdown";

const ROLE_LABEL = {
  customer: "Customer",
  operator: "Bank operator",
  security_admin: "Security administrator",
  auditor: "Auditor",
} as const;

export function UserMenu() {
  const { user } = useSession();
  const { logout } = useAuthActions();
  if (!user) return null;

  return (
    <Dropdown
      trigger={
        <button type="button" aria-label="Account menu" className="rounded-full focus:outline-none focus:ring-2 focus:ring-accent">
          <Avatar initials={user.email.slice(0, 2).toUpperCase()} />
        </button>
      }
    >
      <div className="flex flex-col gap-3 p-1">
        <div>
          <p className="truncate text-sm font-medium text-primary">{user.email}</p>
          <div className="mt-1">
            <Badge>{ROLE_LABEL[user.role]}</Badge>
          </div>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </Dropdown>
  );
}
