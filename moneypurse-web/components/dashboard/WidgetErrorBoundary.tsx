"use client";

import { Component, type ReactNode } from "react";
import { Button } from "../ui/Button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches a render-time throw from one widget's children (a malformed posting, an
 * unparseable date, ...) so it can't crash the rest of the dashboard. React Query's isError
 * only covers fetch failures - this covers everything else, per spec §5's error-boundary
 * requirement. Class component because React has no hook equivalent for error boundaries.
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("A dashboard widget crashed:", error);
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>Something went wrong.</span>
          <Button variant="secondary" onClick={this.reset}>
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
