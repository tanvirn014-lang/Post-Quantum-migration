import { useCallback, useEffect, useState } from "react";

export const WIDGET_IDS = ["accounts", "cashflow", "spending", "pots", "cards", "transactions"] as const;

const STORAGE_KEY = "moneypurse.dashboard.layout.v1";

interface StoredLayout {
  order: string[];
  hidden: string[];
}

function defaultLayout(): StoredLayout {
  return { order: [...WIDGET_IDS], hidden: [] };
}

function loadLayout(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [...WIDGET_IDS], hidden: [] };
    const parsed = JSON.parse(raw) as StoredLayout;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) {
      return { order: [...WIDGET_IDS], hidden: [] };
    }
    return parsed;
  } catch {
    return { order: [...WIDGET_IDS], hidden: [] };
  }
}

function saveLayout(layout: StoredLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function useDashboardLayout() {
  // Always starts from the default on both server and the first client render, so SSR
  // output and the initial hydration pass match exactly (reading localStorage during that
  // first render caused a hydration mismatch whenever a visitor had a non-default saved
  // layout). The real saved layout is applied in an effect, after hydration.
  const [layout, setLayout] = useState<StoredLayout>(defaultLayout);

  useEffect(() => {
    setLayout(loadLayout());
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setLayout((prev) => {
      const order = [...prev.order];
      const [moved] = order.splice(from, 1);
      if (moved === undefined) return prev;
      order.splice(to, 0, moved);
      const next = { ...prev, order };
      saveLayout(next);
      return next;
    });
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setLayout((prev) => {
      const isHidden = prev.hidden.includes(id);
      const hidden = isHidden ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id];
      const next = { ...prev, hidden };
      saveLayout(next);
      return next;
    });
  }, []);

  return {
    order: layout.order,
    hidden: new Set(layout.hidden),
    reorder,
    toggleHidden,
  };
}
