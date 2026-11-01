import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Buttons carry a single, reserved accent for the primary action; secondary actions are quiet
 * bordered surfaces, and ghost actions are text-only. The accessible focus ring is global
 * (:focus-visible in globals.css). Motion is a fast colour feedback only.
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-e1 hover:bg-accent-hover",
  secondary: "bg-surface-raised text-primary border border-subtle hover:border-strong hover:bg-surface-overlay",
  ghost: "bg-transparent text-secondary hover:text-primary hover:bg-surface-overlay",
  danger: "bg-error text-on-accent hover:opacity-90",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium
        transition-colors duration-[var(--motion-micro)] ease-[cubic-bezier(0.2,0,0,1)]
        disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
