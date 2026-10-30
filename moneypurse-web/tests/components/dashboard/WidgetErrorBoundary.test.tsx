import { test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WidgetErrorBoundary } from "../../../components/dashboard/WidgetErrorBoundary.js";

function Boom(): never {
  throw new Error("kaboom");
}

test("renders a fallback instead of crashing when a child throws", () => {
  render(
    <WidgetErrorBoundary>
      <Boom />
    </WidgetErrorBoundary>,
  );
  assert.ok(screen.getByText(/something went wrong/i));
  cleanup();
});

test("Retry resets the boundary so it re-renders children", () => {
  let shouldThrow = true;
  function Flaky() {
    if (shouldThrow) throw new Error("kaboom");
    return <div>recovered</div>;
  }
  render(
    <WidgetErrorBoundary>
      <Flaky />
    </WidgetErrorBoundary>,
  );
  assert.ok(screen.getByText(/something went wrong/i));
  shouldThrow = false;
  fireEvent.click(screen.getByText(/retry/i));
  assert.ok(screen.getByText("recovered"));
  cleanup();
});

test("renders children normally when nothing throws", () => {
  render(
    <WidgetErrorBoundary>
      <div>all good</div>
    </WidgetErrorBoundary>,
  );
  assert.ok(screen.getByText("all good"));
  cleanup();
});
