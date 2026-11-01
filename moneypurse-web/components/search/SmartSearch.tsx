"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useCustomerPostings, useTransactionDescriptions } from "../../hooks/useTransactions";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import { formatCurrency } from "../../lib/format";
import { SimBadge } from "../ui/StatusBadge";

export function SmartSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const suggestionsQuery = useSearchSuggestions(query);
  const postingsQuery = useCustomerPostings(200);
  const postings = postingsQuery.data ?? [];
  const { descriptionsByTransactionId } = useTransactionDescriptions(postings.map((p) => p.transactionId));

  const matchingPostings =
    query.length > 0
      ? postings.filter((p) => (descriptionsByTransactionId[p.transactionId] ?? "").toLowerCase().includes(query.toLowerCase()))
      : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-40 sm:w-64 rounded-lg bg-surface-overlay px-3 py-1.5 text-left text-sm text-muted"
      >
        Search... <span className="float-right text-xs opacity-60">⌘K</span>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        shouldFilter={false}
        label="Smart search"
        className="fixed left-1/2 top-24 w-full max-w-lg -translate-x-1/2 rounded-xl bg-surface-raised border border-subtle shadow-e5 overflow-hidden"
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search transactions, recipients, actions..."
          className="w-full bg-transparent px-4 py-3 text-primary outline-none border-b border-subtle"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No results found.</Command.Empty>

          {matchingPostings.length > 0 && (
            <Command.Group heading="Transactions" className="text-xs text-muted px-2 py-1">
              {matchingPostings.map((p) => (
                <Command.Item
                  key={p.id}
                  onSelect={() => setOpen(false)}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-primary data-[selected=true]:bg-surface-overlay cursor-pointer"
                >
                  <span>{descriptionsByTransactionId[p.transactionId]}</span>
                  <span className="text-muted">{formatCurrency(p.amountMinorUnits, p.currency)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {(suggestionsQuery.data ?? []).length > 0 && (
            <Command.Group
              heading={
                <span className="flex items-center gap-2">
                  Suggestions <SimBadge what="Search suggestions" />
                </span>
              }
              className="text-xs text-muted px-2 py-1"
            >
              {(suggestionsQuery.data ?? []).map((s) => (
                <Command.Item
                  key={s.id}
                  onSelect={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-primary data-[selected=true]:bg-surface-overlay cursor-pointer"
                >
                  {s.label}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command.Dialog>
    </>
  );
}
