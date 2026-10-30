import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface-raised rounded-xl ${className}`}>{children}</div>;
}
