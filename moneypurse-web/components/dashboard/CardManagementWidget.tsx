"use client";

import { useState } from "react";
import { useCards } from "../../hooks/useCards";
import { useSession } from "../../hooks/useSession";
import { SimBadge } from "../ui/StatusBadge";
import { formatCurrency } from "../../lib/format";
import { DashboardWidget } from "./DashboardWidget";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export function CardManagementWidget({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const { user } = useSession();
  const query = useCards(user?.customerId ?? "");
  const [frozenOverride, setFrozenOverride] = useState<Record<string, boolean>>({});
  const card = query.data?.[0];
  const frozen = card ? frozenOverride[card.id] ?? card.frozen : false;

  return (
    <DashboardWidget
      id="cards"
      title="Card"
      badge={<SimBadge what="Card controls" />}
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: query.isLoading, isError: query.isError, refetch: query.refetch }}
    >
      {card && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-gradient-to-br from-surface-overlay to-surface-base p-4 border border-subtle">
            <p className="text-xs text-muted uppercase">{card.brand}</p>
            <p className="text-lg tracking-widest text-primary mt-2">**** **** **** {card.last4}</p>
          </div>
          <div className="flex items-center justify-between">
            <Badge tone={frozen ? "danger" : "success"}>{frozen ? "Frozen" : "Active"}</Badge>
            <span className="text-xs text-muted">Limit: {formatCurrency(card.spendLimitMinorUnits, "BDT")}</span>
          </div>
          <Button
            variant="secondary"
            onClick={() => setFrozenOverride((prev) => ({ ...prev, [card.id]: !frozen }))}
          >
            {frozen ? "Unfreeze card" : "Freeze card"}
          </Button>
        </div>
      )}
    </DashboardWidget>
  );
}
