"use client";

import { useState, type FormEvent } from "react";
import { useAllAccounts, useCreateCustomer, useCustomers, useOpenAccount, type Customer } from "../../hooks/useOperations";
import type { AccountKind } from "../../hooks/useAccounts";
import { formatCurrency } from "../../lib/format";
import { formatDateTime } from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Checkbox, Field, FormError, Select, TextInput } from "../ui/Form";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";

function CreateCustomerForm({ onDone }: { onDone: () => void }) {
  const create = useCreateCustomer();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const valid = fullName.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && password.length >= 12;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      await create.mutateAsync({ fullName: fullName.trim(), email: email.trim(), password });
      onDone();
    } catch {
      // shown below
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Full name">{(id) => <TextInput id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />}</Field>
      <Field label="Email">{(id) => <TextInput id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}</Field>
      <div className="sm:col-span-2">
        <Field label="Initial password" hint="At least 12 characters. The customer must change it at first sign-in.">
          {(id) => <TextInput id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <FormError error={create.error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
          {create.isPending ? "Creating..." : "Create customer"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OpenAccountForm({ customers, onDone }: { customers: Customer[]; onDone: () => void }) {
  const open = useOpenAccount();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [kind, setKind] = useState<AccountKind>("current");
  const [currency, setCurrency] = useState("BDT");
  const [allowOverdraft, setAllowOverdraft] = useState(false);
  const valid = customerId.length > 0 && /^[A-Za-z]{3}$/.test(currency);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      await open.mutateAsync({ ownerCustomerId: customerId, currency: currency.toUpperCase(), kind, allowOverdraft });
      onDone();
    } catch {
      // shown below
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Customer">
        {(id) => (
          <Select id={id} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} ({c.email})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Account type">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            <option value="current">Current</option>
            <option value="savings">Savings</option>
            <option value="settlement">Settlement (bank internal)</option>
          </Select>
        )}
      </Field>
      <Field label="Currency">{(id) => <TextInput id={id} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />}</Field>
      <div className="flex items-end">
        <Checkbox label="Allow overdraft" checked={allowOverdraft} onChange={(e) => setAllowOverdraft(e.target.checked)} />
      </div>
      <div className="sm:col-span-2">
        <FormError error={open.error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={!valid || open.isPending}>
          {open.isPending ? "Opening..." : "Open account"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Minimal bank-operator console: onboard customers and open their accounts. Operators cannot
 *  move customer money or read the audit log - the server enforces that regardless of the UI. */
export function OperationsPanel() {
  const customers = useCustomers();
  const accounts = useAllAccounts();
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [openingAccount, setOpeningAccount] = useState(false);
  const customerList = customers.data ?? [];
  const nameById = new Map(customerList.map((c) => [c.id, c.fullName]));

  return (
    <div className="space-y-5">
      <PageHeader title="Operations" description="Onboard customers and open accounts. Every action is recorded in the audit log." />

      <Panel
        title="Customers"
        actions={
          !creatingCustomer && (
            <Button variant="primary" onClick={() => setCreatingCustomer(true)}>
              New customer
            </Button>
          )
        }
      >
        {creatingCustomer && (
          <div className="mb-4 rounded-lg border border-subtle p-3">
            <CreateCustomerForm onDone={() => setCreatingCustomer(false)} />
          </div>
        )}
        <QueryBoundary query={customers} skeleton={<Skeleton className="h-32" />}>
          {customerList.length === 0 ? (
            <EmptyState title="No customers yet" />
          ) : (
            <DataTable caption="Customers">
              <thead>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Email</th>
                  <th className={TH}>Created</th>
                </tr>
              </thead>
              <tbody>
                {customerList.map((c) => (
                  <tr key={c.id} className={TR}>
                    <td className={TD}>{c.fullName}</td>
                    <td className={TD}>{c.email}</td>
                    <td className={`${TD} text-xs text-muted`}>{formatDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryBoundary>
      </Panel>

      <Panel
        title="Accounts"
        actions={
          !openingAccount &&
          customerList.length > 0 && (
            <Button variant="primary" onClick={() => setOpeningAccount(true)}>
              Open account
            </Button>
          )
        }
      >
        {openingAccount && (
          <div className="mb-4 rounded-lg border border-subtle p-3">
            <OpenAccountForm customers={customerList} onDone={() => setOpeningAccount(false)} />
          </div>
        )}
        <QueryBoundary query={accounts} skeleton={<Skeleton className="h-32" />}>
          {(accounts.data ?? []).length === 0 ? (
            <EmptyState title="No accounts yet" />
          ) : (
            <DataTable caption="Accounts">
              <thead>
                <tr>
                  <th className={TH}>Owner</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Account ID</th>
                  <th className={TH}>Balance</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(accounts.data ?? []).map((a) => (
                  <tr key={a.id} className={TR}>
                    <td className={TD}>{nameById.get(a.ownerCustomerId) ?? "Unknown"}</td>
                    <td className={`${TD} capitalize`}>{a.kind}</td>
                    <td className={`${TD} font-mono text-xs break-all`}>{a.id}</td>
                    <td className={TD}>{formatCurrency(a.balanceMinorUnits, a.currency)}</td>
                    <td className={TD}>
                      <Badge tone={a.status === "active" ? "success" : "danger"}>{a.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryBoundary>
      </Panel>
    </div>
  );
}
