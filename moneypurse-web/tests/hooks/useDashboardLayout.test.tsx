import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
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
