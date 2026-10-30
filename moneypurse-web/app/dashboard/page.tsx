"use client";

import type { ComponentType, ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppShell } from "../../components/layout/AppShell";
import { AccountSummaryCards } from "../../components/dashboard/AccountSummaryCards";
import { CashFlowChart } from "../../components/dashboard/CashFlowChart";
import { SpendingByCategoryChart } from "../../components/dashboard/SpendingByCategoryChart";
import { SavingsPotsWidget } from "../../components/dashboard/SavingsPotsWidget";
import { CardManagementWidget } from "../../components/dashboard/CardManagementWidget";
import { RecentTransactionsWidget } from "../../components/dashboard/RecentTransactionsWidget";
import { AlertBanner } from "../../components/alerts/AlertBanner";
import { Button } from "../../components/ui/Button";
import { useDashboardLayout } from "../../hooks/useDashboardLayout";
import { useState } from "react";

interface WidgetProps {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}

const WIDGET_COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  accounts: AccountSummaryCards,
  cashflow: CashFlowChart,
  spending: SpendingByCategoryChart,
  pots: SavingsPotsWidget,
  cards: CardManagementWidget,
  transactions: RecentTransactionsWidget,
};

/** Makes its child draggable (via the whole card) only while editMode is on - dragging is
 *  disabled otherwise, so the dashboard behaves like a normal static grid for everyday use. */
function SortableSlot({ id, editMode, children }: { id: string; editMode: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled: !editMode });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...(editMode ? { ...attributes, ...listeners } : {})} className={editMode ? "cursor-grab active:cursor-grabbing" : ""}>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { order, hidden, reorder, toggleHidden } = useDashboardLayout();
  const [editMode, setEditMode] = useState(false);

  // Without an activation distance, dnd-kit's PointerSensor treats every pointerdown as a
  // drag attempt and swallows the click that follows (even a plain click with no movement),
  // which made every button inside a widget (Hide, Freeze, period toggles, ...) unclickable
  // in edit mode. Requiring 8px of movement before a drag "activates" lets an ordinary click
  // pass through untouched.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) reorder(oldIndex, newIndex);
  }

  return (
    <AppShell>
      <div className="flex justify-end mb-4">
        <Button variant={editMode ? "primary" : "secondary"} onClick={() => setEditMode((v) => !v)}>
          {editMode ? "Done" : "Customize"}
        </Button>
      </div>
      <AlertBanner />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {order.map((id) => {
              const Widget = WIDGET_COMPONENTS[id];
              if (!Widget) return null;
              return (
                <SortableSlot key={id} id={id} editMode={editMode}>
                  <Widget editMode={editMode} hidden={hidden.has(id)} onToggleHidden={() => toggleHidden(id)} />
                </SortableSlot>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </AppShell>
  );
}
