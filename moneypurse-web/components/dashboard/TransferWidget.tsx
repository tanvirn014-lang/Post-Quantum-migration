"use client";

import { useRef, useState, type FormEvent } from "react";
import { accountLabels, customerFacingAccounts } from "../../lib/accounts";
import { formatCurrency, parseAmountToMinorUnits } from "../../lib/format";
import { useAccounts } from "../../hooks/useAccounts";
import { useTransfer } from "../../hooks/useTransfer";
import { DashboardWidget } from "./DashboardWidget";
import { Button } from "../ui/Button";
import { Field, FormError, Select, TextInput } from "../ui/Form";

const OTHER = "__other__";

/** A real money movement: POST /transfers with an Idempotency-Key, so a retry never double-posts. */
export function TransferWidget({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const query = useAccounts();
  const transfer = useTransfer();
  const own = customerFacingAccounts(query.data ?? []);
  const labels = accountLabels(own);

  const [fromId, setFromId] = useState("");
  const [toChoice, setToChoice] = useState("");
  const [otherTo, setOtherTo] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("Transfer");
  const [done, setDone] = useState<string | null>(null);
  // One key per intended transfer: kept across retries of the same values, replaced on any edit.
  const keyRef = useRef<string | null>(null);

  const from = own.find((a) => a.id === (fromId || own[0]?.id));
  const toId = toChoice === OTHER ? otherTo.trim() : toChoice || own.find((a) => a.id !== from?.id)?.id || "";
  const minor = parseAmountToMinorUnits(amount);
  const amountError = amount.length > 0 && minor === null ? "Enter a positive amount with at most two decimals, e.g. 1250.50" : undefined;
  const canSubmit = !!from && toId.length > 0 && minor !== null && description.trim().length > 0 && !transfer.isPending;

  function edited<T>(setter: (v: T) => void) {
    return (value: T) => {
      keyRef.current = null;
      setDone(null);
      transfer.reset();
      setter(value);
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !from || minor === null) return;
    keyRef.current ??= crypto.randomUUID();
    try {
      await transfer.mutateAsync({
        idempotencyKey: keyRef.current,
        fromAccountId: from.id,
        toAccountId: toId,
        amountMinorUnits: minor,
        currency: from.currency,
        description: description.trim(),
      });
      keyRef.current = null;
      setAmount("");
      setDone(`Sent ${formatCurrency(minor, from.currency)}.`);
    } catch {
      // The error is shown from transfer.error; the key is kept so Retry replays safely.
    }
  }

  return (
    <DashboardWidget
      id="transfer"
      title="Send money"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: query.isLoading, isError: query.isError, refetch: () => void query.refetch() }}
    >
      {own.length === 0 ? (
        <p className="text-sm text-muted">You need an account before you can send money.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <Field label="From">
            {(id) => (
              <Select id={id} value={from?.id ?? ""} onChange={(e) => edited(setFromId)(e.target.value)}>
                {own.map((a) => (
                  <option key={a.id} value={a.id}>
                    {labels.get(a.id)} - {formatCurrency(a.balanceMinorUnits, a.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <Select id={id} value={toChoice || toId} onChange={(e) => edited(setToChoice)(e.target.value)}>
                {own
                  .filter((a) => a.id !== from?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      My {labels.get(a.id)?.toLowerCase()}
                    </option>
                  ))}
                <option value={OTHER}>Another account (enter ID)...</option>
              </Select>
            )}
          </Field>
          {toChoice === OTHER && (
            <Field label="Destination account ID">
              {(id) => <TextInput id={id} value={otherTo} onChange={(e) => edited(setOtherTo)(e.target.value)} placeholder="acc_..." autoComplete="off" />}
            </Field>
          )}
          <Field label={`Amount (${from?.currency ?? "BDT"})`} error={amountError}>
            {(id) => <TextInput id={id} inputMode="decimal" value={amount} onChange={(e) => edited(setAmount)(e.target.value)} placeholder="0.00" autoComplete="off" />}
          </Field>
          <Field label="Description">
            {(id) => <TextInput id={id} maxLength={140} value={description} onChange={(e) => edited(setDescription)(e.target.value)} />}
          </Field>
          <FormError error={transfer.error} />
          {done && (
            <p role="status" className="text-sm text-success">
              {done}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {transfer.isPending ? "Sending..." : transfer.isError ? "Retry" : "Send"}
          </Button>
        </form>
      )}
    </DashboardWidget>
  );
}
