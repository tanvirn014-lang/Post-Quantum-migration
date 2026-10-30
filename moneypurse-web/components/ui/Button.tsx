import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-surface-base hover:opacity-90",
  secondary: "bg-surface-overlay text-primary hover:opacity-90",
  ghost: "bg-transparent text-muted hover:text-primary",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
