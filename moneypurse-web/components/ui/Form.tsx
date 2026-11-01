import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

const CONTROL = "w-full rounded-md bg-surface-raised border border-subtle px-3 py-2 text-sm text-primary placeholder:text-muted transition-colors focus:outline-none focus:border-accent hover:border-strong disabled:opacity-60 disabled:cursor-not-allowed";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${className}`} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-primary">
      <input type="checkbox" {...props} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

/** Renders an error from the API: its message, plus any password-policy problems it listed. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const problems = (error as { details?: { problems?: string[] } } | null)?.details?.problems;
  return (
    <div role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
      <p>{message}</p>
      {problems && problems.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
