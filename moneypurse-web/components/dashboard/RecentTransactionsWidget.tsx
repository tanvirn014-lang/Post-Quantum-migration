"use client";

import { useState } from "react";
import { useCustomerPostings, useTransactionDescriptions } from "../../hooks/useTransactions";
import { formatCurrency, formatRelativeDate } from "../../lib/format";
import { categorize } from "../../lib/categorize";
import { DashboardWidget } from "./DashboardWidget";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";

const RECENT_COUNT = 5;

export function RecentTransactionsWidget({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const postingsQuery = useCustomerPostings(200);
  const postings = postingsQuery.data ?? [];
  const transactionIds = postings.map((p) => p.transactionId);
  const {
    descriptionsByTransactionId,
    isLoading: descriptionsLoading,
    isError: descriptionsError,
    refetch: refetchDescriptions,
  } = useTransactionDescriptions(transactionIds);

  const recent = postings.slice(0, RECENT_COUNT);

  function row(p: (typeof postings)[number]) {
    const description = descriptionsByTransactionId[p.transactionId] ?? "Transaction";
    return (
      <li key={p.id} className="flex items-center justify-between text-sm">
        <div className="flex flex-col">
          <span className="text-primary">{description}</span>
          <span className="text-xs text-muted">
            {categorize(description)} · {formatRelativeDate(p.createdAt)}
          </span>
        </div>
        <span className={p.amountMinorUnits.startsWith("-") ? "text-muted" : "text-primary"}>
          {formatCurrency(p.amountMinorUnits, p.currency)}
        </span>
      </li>
    );
  }

  return (
    <DashboardWidget
      id="transactions"
      title="Recent Transactions"
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
      {recent.length === 0 ? (
        <p className="text-sm text-muted">No transactions yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">{recent.map(row)}</ul>
          <Button variant="ghost" onClick={() => setViewAllOpen(true)} className="mt-3">
            View all
          </Button>
        </>
      )}

      <Drawer open={viewAllOpen} onOpenChange={setViewAllOpen} title="All transactions">
        <ul className="flex flex-col gap-3">{postings.map(row)}</ul>
      </Drawer>
    </DashboardWidget>
  );
}
