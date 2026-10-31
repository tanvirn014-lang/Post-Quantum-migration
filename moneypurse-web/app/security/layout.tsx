import type { ReactNode } from "react";
import { ConsoleShell } from "../../components/layout/ConsoleShell";

const NAV = [
  { href: "/security", label: "Overview" },
  { href: "/security/status", label: "Implementation status" },
  { href: "/security/peers", label: "Peers" },
  { href: "/security/crypto", label: "Crypto agility" },
  { href: "/security/telemetry", label: "Telemetry" },
  { href: "/security/audit", label: "Audit log" },
];

export default function SecurityLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell title="security console" nav={NAV} notice>
      {children}
    </ConsoleShell>
  );
}
