import { assertAccountsPostable, assertBalanced, assertSufficientFunds, computeNewBalances } from "../../domain/ledger.js";
import { newAccountId, newPostingId, newTransactionId } from "../../domain/ids.js";
import type { Account, Posting, Transaction, TransactionInput } from "../../domain/ledger.js";
import { IdempotencyKeyReusedError, TransactionNotFoundError, TransactionNotReversibleError } from "../../domain/errors.js";
import { hashTransactionRequest } from "../../app/idempotency.js";
import type { BalanceDrift, CreateAccountInput, LedgerStore, ListAccountsOptions, PostTransactionAudit, ReverseTransactionInput } from "../../ports/ledger-store.js";
import type { AuditStore } from "../../ports/audit-store.js";

/**
 * In-process implementation of LedgerStore. Node is single-threaded, so there is no real
 * concurrent-write race to guard against here - this exists for fast unit/integration tests
 * and local development without Postgres, not as a production store.
 */
export class MemoryLedgerStore implements LedgerStore {
  private accounts = new Map<string, Account>();
  private transactions = new Map<string, Transaction>();
  private postingsByTransaction = new Map<string, Posting[]>();
  private postingsByAccount = new Map<string, Posting[]>();
  private idempotencyIndex = new Map<string, { transactionId: string; requestHash: string }>();

  /** The audit appender used to record a posting's audit event in the same (synchronous) unit of
   *  work. Node is single-threaded, so appending before the maps mutate makes the two atomic. */
  constructor(private readonly audit?: Pick<AuditStore, "append">) {}

  async createAccount(input: CreateAccountInput): Promise<Account> {
    const account: Account = {
      id: newAccountId(),
      ownerCustomerId: input.ownerCustomerId,
      currency: input.currency.toUpperCase(),
      kind: input.kind ?? "current",
      status: "active",
      balanceMinorUnits: 0n,
      allowOverdraft: input.allowOverdraft ?? false,
      createdAt: new Date(),
    };
    this.accounts.set(account.id, account);
    return { ...account };
  }

  async getAccount(accountId: string): Promise<Account | null> {
    const account = this.accounts.get(accountId);
    return account ? { ...account } : null;
  }

  async listAccounts(opts?: ListAccountsOptions): Promise<Account[]> {
    const all = [...this.accounts.values()]
      .filter((a) => opts?.customerId === undefined || a.ownerCustomerId === opts.customerId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return all.slice(0, opts?.limit ?? 100).map((a) => ({ ...a }));
  }

  async postTransaction(input: TransactionInput, auditBuilder?: PostTransactionAudit): Promise<Transaction> {
    assertBalanced(input.postings);

    const requestHash = hashTransactionRequest(input);
    const existing = this.idempotencyIndex.get(input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyReusedError(input.idempotencyKey);
      }
      const transaction = this.transactions.get(existing.transactionId);
      if (!transaction) throw new Error("Idempotency index pointed at a missing transaction");
      return { ...transaction };
    }

    assertAccountsPostable(this.accounts, input.postings);
    const newBalances = computeNewBalances(this.accounts, input.postings);
    assertSufficientFunds(this.accounts, newBalances);

    const transactionId = newTransactionId();
    const postedAt = new Date();
    const transaction: Transaction = {
      id: transactionId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      status: "posted",
      postedAt,
      metadata: { ...(input.metadata ?? {}), ...(input.context ? { context: input.context } : {}) },
    };
    const postings: Posting[] = input.postings.map((p) => ({
      id: newPostingId(),
      transactionId,
      accountId: p.accountId,
      amountMinorUnits: p.amountMinorUnits,
      currency: p.currency.toUpperCase(),
      createdAt: postedAt,
    }));

    // Record the posting's audit event before mutating any map, so a failure leaves nothing behind.
    if (auditBuilder) {
      if (!this.audit) throw new Error("MemoryLedgerStore was given no audit appender but a posting audit was requested");
      await this.audit.append(auditBuilder({ ...transaction }), new Date());
    }

    this.transactions.set(transactionId, transaction);
    this.postingsByTransaction.set(transactionId, postings);
    for (const posting of postings) {
      const list = this.postingsByAccount.get(posting.accountId) ?? [];
      list.push(posting);
      this.postingsByAccount.set(posting.accountId, list);
    }
    for (const [accountId, newBalance] of newBalances) {
      const account = this.accounts.get(accountId)!;
      this.accounts.set(accountId, { ...account, balanceMinorUnits: newBalance });
    }
    this.idempotencyIndex.set(input.idempotencyKey, { transactionId, requestHash });

    return { ...transaction };
  }

  async getTransactionWithPostings(
    transactionId: string,
  ): Promise<{ transaction: Transaction; postings: Posting[] } | null> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return null;
    const postings = this.postingsByTransaction.get(transactionId) ?? [];
    return { transaction: { ...transaction }, postings: postings.map((p) => ({ ...p })) };
  }

  async getTransactionByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null> {
    const entry = this.idempotencyIndex.get(idempotencyKey);
    if (!entry) return null;
    const transaction = this.transactions.get(entry.transactionId);
    return transaction ? { ...transaction } : null;
  }

  async listPostingsForAccount(accountId: string, opts?: { limit?: number }): Promise<Posting[]> {
    const postings = this.postingsByAccount.get(accountId) ?? [];
    const ordered = [...postings].reverse();
    const limit = opts?.limit ?? 50;
    return ordered.slice(0, limit).map((p) => ({ ...p }));
  }

  async reverseTransaction(input: ReverseTransactionInput, auditBuilder?: PostTransactionAudit): Promise<Transaction> {
    const orig = this.transactions.get(input.originalTransactionId);
    if (!orig) throw new TransactionNotFoundError(input.originalTransactionId);
    if (orig.status !== "posted") throw new TransactionNotReversibleError(input.originalTransactionId);

    const origPostings = this.postingsByTransaction.get(input.originalTransactionId) ?? [];
    const compensating = origPostings.map((p) => ({ accountId: p.accountId, amountMinorUnits: -p.amountMinorUnits, currency: p.currency }));
    assertBalanced(compensating);
    assertAccountsPostable(this.accounts, compensating);
    const newBalances = computeNewBalances(this.accounts, compensating);
    assertSufficientFunds(this.accounts, newBalances);

    const reversalId = newTransactionId();
    const postedAt = new Date();
    const reversal: Transaction = {
      id: reversalId,
      idempotencyKey: `reverse:${input.originalTransactionId}`,
      description: `Reversal of ${input.originalTransactionId}: ${input.reason}`,
      status: "posted",
      postedAt,
      metadata: { context: { reverses: input.originalTransactionId, reason: input.reason } },
    };
    const postings: Posting[] = compensating.map((p) => ({
      id: newPostingId(),
      transactionId: reversalId,
      accountId: p.accountId,
      amountMinorUnits: p.amountMinorUnits,
      currency: p.currency.toUpperCase(),
      createdAt: postedAt,
    }));

    // Audit before mutating any map, so a failure leaves nothing behind (mirrors postTransaction).
    if (auditBuilder) {
      if (!this.audit) throw new Error("MemoryLedgerStore was given no audit appender but a reversal audit was requested");
      await this.audit.append(auditBuilder({ ...reversal }), new Date());
    }

    this.transactions.set(reversalId, reversal);
    this.postingsByTransaction.set(reversalId, postings);
    for (const posting of postings) {
      const list = this.postingsByAccount.get(posting.accountId) ?? [];
      list.push(posting);
      this.postingsByAccount.set(posting.accountId, list);
    }
    for (const [accountId, newBalance] of newBalances) {
      const account = this.accounts.get(accountId)!;
      this.accounts.set(accountId, { ...account, balanceMinorUnits: newBalance });
    }
    this.transactions.set(input.originalTransactionId, { ...orig, status: "reversed" });
    this.idempotencyIndex.set(reversal.idempotencyKey, { transactionId: reversalId, requestHash: "reversal" });

    return { ...reversal };
  }

  async reconcileBalances(): Promise<BalanceDrift[]> {
    const drifts: BalanceDrift[] = [];
    for (const account of this.accounts.values()) {
      const derived = (this.postingsByAccount.get(account.id) ?? []).reduce((sum, p) => sum + p.amountMinorUnits, 0n);
      if (derived !== account.balanceMinorUnits) {
        drifts.push({ accountId: account.id, storedBalanceMinorUnits: account.balanceMinorUnits, derivedBalanceMinorUnits: derived });
      }
    }
    return drifts;
  }
}
