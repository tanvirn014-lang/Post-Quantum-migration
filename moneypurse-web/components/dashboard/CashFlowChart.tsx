"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCustomerPostings } from "../../hooks/useTransactions";
import { aggregateCashFlow, type CashFlowPeriod } from "../../lib/aggregate-cash-flow";
import { DashboardWidget } from "./DashboardWidget";
import { Button } from "../ui/Button";

const PERIODS: CashFlowPeriod[] = ["week", "month", "year"];

export function CashFlowChart({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const [period, setPeriod] = useState<CashFlowPeriod>("week");
  const query = useCustomerPostings(200);

  // `now` is only ever set client-side, after mount - aggregateCashFlow is never called
  // with a fresh Date() during server rendering, which Next's Cache Components flags as
  // an unstable value if read during prerender.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const data = now ? aggregateCashFlow(query.data ?? [], period, now) : [];

  return (
    <DashboardWidget
      id="cashflow"
      title="Cash Flow"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: query.isLoading, isError: query.isError, refetch: query.refetch }}
    >
      <div className="flex gap-2 mb-3">
        {PERIODS.map((p) => (
          <Button key={p} variant={p === period ? "primary" : "ghost"} onClick={() => setPeriod(p)}>
            {p[0]!.toUpperCase() + p.slice(1)}
          </Button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={12} />
          <YAxis stroke="var(--text-muted)" fontSize={12} />
          <Tooltip
            contentStyle={{ background: "var(--surface-overlay)", border: "1px solid var(--border-subtle)" }}
            labelStyle={{ color: "var(--text-primary)" }}
          />
          <Bar dataKey="income" fill="var(--accent)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" fill="var(--text-muted)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </DashboardWidget>
  );
}
