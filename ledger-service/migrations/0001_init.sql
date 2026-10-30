-- Ids are application-generated, prefixed strings ("acc_<uuid>", "txn_<uuid>", "pst_<uuid>" -
-- see src/domain/ids.ts), not native UUIDs, so every LedgerStore implementation (memory or
-- Postgres) produces identically-shaped ids. They are TEXT, not UUID, columns for that reason.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  owner_customer_id UUID NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  balance_minor_units BIGINT NOT NULL DEFAULT 0,
  allow_overdraft BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT balance_nonnegative_unless_overdraft CHECK (allow_overdraft OR balance_minor_units >= 0)
);

CREATE INDEX accounts_owner_customer_id_idx ON accounts (owner_customer_id);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE postings (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  amount_minor_units BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX postings_account_id_idx ON postings (account_id, created_at DESC);
CREATE INDEX postings_transaction_id_idx ON postings (transaction_id);

-- Defense in depth: the application enforces the double-entry invariant before it ever
-- writes a row, but a direct SQL write or a future bug must not be able to leave an
-- unbalanced transaction committed. This trigger re-checks it at commit time.
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
  unbalanced_currency TEXT;
BEGIN
  SELECT currency INTO unbalanced_currency
  FROM postings
  WHERE transaction_id = NEW.transaction_id
  GROUP BY currency
  HAVING SUM(amount_minor_units) <> 0
  LIMIT 1;

  IF unbalanced_currency IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction % is not balanced for currency %', NEW.transaction_id, unbalanced_currency;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balanced_check
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_transaction_balanced();
