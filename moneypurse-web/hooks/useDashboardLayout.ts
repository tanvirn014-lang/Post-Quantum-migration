import { useCallback, useEffect, useState } from "react";

export const WIDGET_IDS = ["accounts", "transfer", "cashflow", "spending", "pots", "cards", "transactions"] as const;

const STORAGE_KEY = "moneypurse.dashboard.layout.v1";

interface StoredLayout {
  order: string[];
  hidden: string[];
}

function defaultLayout(): StoredLayout {
  return { order: [...WIDGET_IDS], hidden: [] };
}

// Drops any id that no longer names a widget (a version removed one) and appends any
// widget id missing from a stored layout (a version added one), so a schema change never
// produces an incomplete or stale dashboard.
function sanitizeLayout(stored: StoredLayout): StoredLayout {
  const known = new Set<string>(WIDGET_IDS);
  const order = stored.order.filter((id) => known.has(id));
  for (const id of WIDGET_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden = stored.hidden.filter((id) => known.has(id));
  return { order, hidden };
}

function loadLayout(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as StoredLayout;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) {
      return defaultLayout();
    }
    return sanitizeLayout(parsed);
  } catch {
    return defaultLayout();
  }
}

function saveLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Best-effort persistence - a full or unavailable localStorage should not break the
    // in-memory layout the user just set.
  }
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

  // Persisting here, rather than inside reorder/toggleHidden's updater, keeps those
  // updaters pure (React may invoke a state updater more than once) and keeps a storage
  // failure from ever being thrown mid-render.
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const reorder = useCallback((from: number, to: number) => {
    setLayout((prev) => {
      const order = [...prev.order];
      const [moved] = order.splice(from, 1);
      if (moved === undefined) return prev;
      order.splice(to, 0, moved);
      return { ...prev, order };
    });
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setLayout((prev) => {
      const isHidden = prev.hidden.includes(id);
      const hidden = isHidden ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id];
      return { ...prev, hidden };
    });
  }, []);

  return {
    order: layout.order,
    hidden: new Set(layout.hidden),
    reorder,
    toggleHidden,
  };
}
