"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useCustomerPostings, useTransactionDescriptions } from "../../hooks/useTransactions";
import { aggregateByCategory } from "../../lib/aggregate-by-category";
import { formatCurrency } from "../../lib/format";
import { DashboardWidget } from "./DashboardWidget";
import { Drawer } from "../ui/Drawer";

const SLICE_COLORS = ["var(--accent)", "#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fbbf24"];

export function SpendingByCategoryChart({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const postingsQuery = useCustomerPostings(200);
  const postings = postingsQuery.data ?? [];
  const transactionIds = postings.map((p) => p.transactionId);
  const {
    descriptionsByTransactionId,
    isLoading: descriptionsLoading,
    isError: descriptionsError,
    refetch: refetchDescriptions,
  } = useTransactionDescriptions(transactionIds);

  const categories = aggregateByCategory(postings, descriptionsByTransactionId);
  const selected = categories.find((c) => c.category === selectedCategory) ?? null;

  // Recharts' Pie only plots a dataKey whose value is typeof "number" - totalMinorUnits is
  // deliberately a string everywhere else (the money-as-string convention), so the chart
  // gets its own numeric major-units field here, same conversion CashFlowChart already does.
  const chartData = categories.map((c) => ({ ...c, value: Number(c.totalMinorUnits) / 100 }));

  return (
    <DashboardWidget
      id="spending"
      title="Spending by Category"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{
        isLoading: postingsQuery.isLoading || descriptionsLoading,
        isError: postingsQuery.isError || descriptionsError,
        refetch: () => {
          postingsQuery.refetch();
          refetchDescriptions();
        },
      }}
    >
      {categories.length === 0 ? (
        <p className="text-sm text-muted">No spending yet.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="category"
                innerRadius={50}
                outerRadius={80}
                onClick={(entry) => setSelectedCategory((entry as unknown as { category: string }).category)}
                cursor="pointer"
              >
                {categories.map((c, i) => (
                  <Cell key={c.category} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "var(--surface-overlay)", border: "1px solid var(--border-subtle)" }}
                formatter={(_value, _name, item) => formatCurrency((item?.payload as { totalMinorUnits?: string })?.totalMinorUnits ?? "0", "BDT")}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {categories.map((c, i) => (
              <li key={c.category}>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(c.category)}
                  className="flex items-center gap-1.5 hover:text-primary"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  {c.category}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Drawer open={selected !== null} onOpenChange={(open) => !open && setSelectedCategory(null)} title={selected?.category ?? ""}>
        <ul className="flex flex-col gap-3">
          {selected?.postings.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <span className="text-muted">{descriptionsByTransactionId[p.transactionId] ?? "Transaction"}</span>
              <span className="text-primary font-medium">{formatCurrency(p.amountMinorUnits, p.currency)}</span>
            </li>
          ))}
        </ul>
      </Drawer>
    </DashboardWidget>
  );
}
