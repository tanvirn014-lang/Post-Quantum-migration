import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboardLayout, WIDGET_IDS } from "../../hooks/useDashboardLayout.js";

beforeEach(() => {
  globalThis.localStorage.clear();
});

test("defaults to WIDGET_IDS in order with nothing hidden when storage is empty", () => {
  const { result } = renderHook(() => useDashboardLayout());
  assert.deepStrictEqual(result.current.order, WIDGET_IDS);
  assert.strictEqual(result.current.hidden.size, 0);
});

test("falls back to the default when localStorage holds corrupt JSON", () => {
  globalThis.localStorage.setItem("moneypurse.dashboard.layout.v1", "{not json");
  const { result } = renderHook(() => useDashboardLayout());
  assert.deepStrictEqual(result.current.order, WIDGET_IDS);
});

test("toggleHidden adds and removes an id from the hidden set, and persists it", () => {
  const { result } = renderHook(() => useDashboardLayout());
  act(() => result.current.toggleHidden("cards"));
  assert.strictEqual(result.current.hidden.has("cards"), true);
  const stored = JSON.parse(globalThis.localStorage.getItem("moneypurse.dashboard.layout.v1")!);
  assert.deepStrictEqual(stored.hidden, ["cards"]);
  act(() => result.current.toggleHidden("cards"));
  assert.strictEqual(result.current.hidden.has("cards"), false);
});

test("reorder moves an id from one index to another and persists it", () => {
  const { result } = renderHook(() => useDashboardLayout());
  act(() => result.current.reorder(0, 2));
  assert.strictEqual(result.current.order[2], WIDGET_IDS[0]);
});

test("restores a previously saved layout after mount", async () => {
  globalThis.localStorage.setItem(
    "moneypurse.dashboard.layout.v1",
    JSON.stringify({ order: ["cashflow", "accounts", "spending", "pots", "cards", "transactions"], hidden: ["cards"] }),
  );
  const { result } = renderHook(() => useDashboardLayout());
  await waitFor(() => assert.strictEqual(result.current.order[0], "cashflow"));
  assert.strictEqual(result.current.hidden.has("cards"), true);
});

test("sanitizes a stored layout with an unknown id, keeping only known ids and appending missing ones", async () => {
  globalThis.localStorage.setItem(
    "moneypurse.dashboard.layout.v1",
    JSON.stringify({ order: ["cashflow", "a-widget-removed-in-a-later-version"], hidden: ["a-widget-removed-in-a-later-version", "pots"] }),
  );
  const { result } = renderHook(() => useDashboardLayout());
  await waitFor(() => assert.strictEqual(result.current.order.length, WIDGET_IDS.length));
  assert.deepStrictEqual([...result.current.order].sort(), [...WIDGET_IDS].sort());
  assert.strictEqual(result.current.order[0], "cashflow");
  assert.strictEqual(result.current.hidden.has("pots"), true);
  assert.strictEqual(result.current.hidden.has("a-widget-removed-in-a-later-version"), false);
});

test("falls back to the default when localStorage.getItem throws", async () => {
  const original = globalThis.localStorage.getItem.bind(globalThis.localStorage);
  globalThis.localStorage.getItem = () => {
    throw new Error("storage unavailable");
  };
  try {
    const { result } = renderHook(() => useDashboardLayout());
    await waitFor(() => assert.deepStrictEqual(result.current.order, WIDGET_IDS));
  } finally {
    globalThis.localStorage.getItem = original;
  }
});

test("does not throw when localStorage.setItem throws - state still updates in memory", () => {
  const original = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  globalThis.localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  try {
    const { result } = renderHook(() => useDashboardLayout());
    assert.doesNotThrow(() => act(() => result.current.toggleHidden("cards")));
    assert.strictEqual(result.current.hidden.has("cards"), true);
  } finally {
    globalThis.localStorage.setItem = original;
  }
});
