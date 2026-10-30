import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

export interface DashboardWidgetQueryState {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export interface DashboardWidgetProps {
  id: string;
  title: string;
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  query: DashboardWidgetQueryState;
  children: ReactNode;
}

/**
 * The common shell every dashboard widget renders inside: a loading skeleton, an inline
 * retry state on error, and hide/show affordances in edit mode. One React Query failure
 * never takes down a sibling widget, since each widget owns its own query state.
 */
export function DashboardWidget({ id, title, editMode, hidden, onToggleHidden, query, children }: DashboardWidgetProps) {
  if (hidden && !editMode) {
    return null;
  }

  return (
    <Card className={`p-4 flex flex-col gap-3 ${hidden ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{title}</h2>
        {editMode && (
          <Button variant="ghost" onClick={onToggleHidden} aria-label={hidden ? `Show ${id}` : `Hide ${id}`}>
            {hidden ? "Show" : "Hide"}
          </Button>
        )}
      </div>

      {query.isLoading && <div className="h-24 rounded-lg bg-surface-overlay animate-pulse" />}

      {query.isError && !query.isLoading && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>Couldn&apos;t load this.</span>
          <Button variant="secondary" onClick={query.refetch}>
            Retry
          </Button>
        </div>
      )}

      {!query.isLoading && !query.isError && children}
    </Card>
  );
}
