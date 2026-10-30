import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-overlay text-muted",
  success: "bg-emerald-500/15 text-emerald-400",
  warning: "bg-accent/15 text-accent",
  danger: "bg-red-500/15 text-red-400",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
