"use client";

import { useState } from "react";
import { DEMO_CUSTOMER_ACCOUNTS } from "../../lib/demo-accounts";
import { useSavingsPots, type Pot } from "../../hooks/useSavingsPots";
import { formatCurrency } from "../../lib/format";
import { DashboardWidget } from "./DashboardWidget";
import { ProgressBar } from "../ui/ProgressBar";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";

export function SavingsPotsWidget({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const query = useSavingsPots(DEMO_CUSTOMER_ACCOUNTS.primary);
  const [addOpen, setAddOpen] = useState(false);
  const [localPots, setLocalPots] = useState<Pot[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const pots = [...(query.data ?? []), ...localPots];

  function handleAddPot() {
    if (!name || !target) return;
    setLocalPots((prev) => [
      ...prev,
      {
        id: `pot_local_${prev.length}`,
        name,
        targetMinorUnits: String(Math.round(Number(target) * 100)),
        currentMinorUnits: "0",
        currency: "BDT",
      },
    ]);
    setName("");
    setTarget("");
    setAddOpen(false);
  }

  return (
    <DashboardWidget
      id="pots"
      title="Savings Pots"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: query.isLoading, isError: query.isError, refetch: query.refetch }}
    >
      <div className="flex flex-col gap-4">
        {pots.map((pot) => (
          <div key={pot.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-primary">{pot.name}</span>
              <span className="text-muted">
                {formatCurrency(pot.currentMinorUnits, pot.currency)} / {formatCurrency(pot.targetMinorUnits, pot.currency)}
              </span>
            </div>
            <ProgressBar value={Number(pot.currentMinorUnits)} max={Number(pot.targetMinorUnits)} />
          </div>
        ))}
        <Button variant="ghost" onClick={() => setAddOpen(true)}>
          + Add pot
        </Button>
      </div>

      <Drawer open={addOpen} onOpenChange={setAddOpen} title="New savings pot">
        <div className="flex flex-col gap-3">
          <input
            className="bg-surface-overlay rounded-lg px-3 py-2 text-sm text-primary"
            placeholder="Pot name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="bg-surface-overlay rounded-lg px-3 py-2 text-sm text-primary"
            placeholder="Target amount (BDT)"
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Button variant="primary" onClick={handleAddPot}>
            Create pot
          </Button>
        </div>
      </Drawer>
    </DashboardWidget>
  );
}
