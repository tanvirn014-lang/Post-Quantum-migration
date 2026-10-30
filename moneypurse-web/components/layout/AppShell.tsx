import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { Header } from "./Header.js";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header greeting="Good morning, Alex" lowBalance={false} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
