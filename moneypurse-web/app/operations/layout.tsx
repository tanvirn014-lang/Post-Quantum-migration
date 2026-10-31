import type { ReactNode } from "react";
import { ConsoleShell } from "../../components/layout/ConsoleShell";

export default function OperationsLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell title="operations" nav={[{ href: "/operations", label: "Customers and accounts" }]}>
      {children}
    </ConsoleShell>
  );
}
