import type { ReactNode } from "react";
import { Button } from "./Button";

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`rounded-lg bg-surface-overlay animate-pulse ${className}`} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-subtle px-4 py-8 text-center">
      <p className="text-sm font-medium text-primary">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const requestId = (error as { requestId?: string } | null)?.requestId;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-500/10 px-4 py-3 text-sm">
      <div>
        <p className="text-red-300">{message}</p>
        {requestId && <p className="mt-0.5 text-xs text-muted">Request id: {requestId}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** One consistent loading / error-with-retry wrapper for any React Query result. */
export function QueryBoundary({ query, skeleton, children }: { query: QueryLike; skeleton?: ReactNode; children: ReactNode }) {
  if (query.isLoading) return <>{skeleton ?? <Skeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children}</>;
}
