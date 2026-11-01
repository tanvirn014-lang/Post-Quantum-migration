import type { ReactNode } from "react";

/**
 * A spatial content surface: an opaque white card raised off the canvas with a hairline border and
 * a soft directional shadow. `elevation` selects the shadow level (1 inset-ish, 2 standard card,
 * 3 raised/interactive); `interactive` adds a subtle hover lift for clickable cards. Keeping the
 * surface opaque (never translucent) is deliberate — critical banking content must stay legible.
 */
const ELEVATION: Record<1 | 2 | 3, string> = {
  1: "shadow-e1",
  2: "shadow-e2",
  3: "shadow-e3",
};

export function Card({
  children,
  className = "",
  elevation = 2,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  elevation?: 1 | 2 | 3;
  interactive?: boolean;
}) {
  const hover = interactive
    ? "transition-shadow duration-[var(--motion-surface)] ease-[cubic-bezier(0.2,0,0,1)] hover:shadow-e3"
    : "";
  return (
    <div className={`bg-surface-raised rounded-lg border border-subtle ${ELEVATION[elevation]} ${hover} ${className}`}>
      {children}
    </div>
  );
}
