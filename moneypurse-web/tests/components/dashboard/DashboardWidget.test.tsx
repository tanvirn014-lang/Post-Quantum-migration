import { test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DashboardWidget } from "../../../components/dashboard/DashboardWidget.js";

test("shows a retry button on error, and calls refetch when clicked", () => {
  let refetchCalled = false;
  const refetch = () => {
    refetchCalled = true;
  };
  render(
    <DashboardWidget
      id="x"
      title="X"
      editMode={false}
      hidden={false}
      onToggleHidden={() => {}}
      query={{ isLoading: false, isError: true, refetch }}
    >
      <div>content</div>
    </DashboardWidget>,
  );
  assert.ok(screen.getByText(/retry/i));
  fireEvent.click(screen.getByText(/retry/i));
  assert.strictEqual(refetchCalled, true);
  cleanup();
});

test("renders nothing when hidden and not in edit mode", () => {
  const { container } = render(
    <DashboardWidget
      id="x"
      title="X"
      editMode={false}
      hidden={true}
      onToggleHidden={() => {}}
      query={{ isLoading: false, isError: false, refetch: () => {} }}
    >
      <div>content</div>
    </DashboardWidget>,
  );
  assert.strictEqual(container.textContent, "");
  cleanup();
});

test("renders children when not loading and not errored", () => {
  render(
    <DashboardWidget
      id="x"
      title="X"
      editMode={false}
      hidden={false}
      onToggleHidden={() => {}}
      query={{ isLoading: false, isError: false, refetch: () => {} }}
    >
      <div>content</div>
    </DashboardWidget>,
  );
  assert.ok(screen.getByText("content"));
  cleanup();
});
