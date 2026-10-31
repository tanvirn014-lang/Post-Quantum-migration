-- Identity, customers and the tamper-evident audit log.

CREATE TABLE customers (
  id UUID PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX customers_email_key ON customers (email);

-- Accounts created before this migration reference customers that were never recorded.
-- Backfill placeholder customer rows so the foreign key below can be added without
-- rewriting or deleting any ledger data.
INSERT INTO customers (id, full_name, email)
SELECT DISTINCT owner_customer_id,
       'Legacy customer ' || left(owner_customer_id::text, 8),
       'legacy-' || owner_customer_id::text || '@invalid.example'
FROM accounts
ON CONFLICT DO NOTHING;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_customer_fk FOREIGN KEY (owner_customer_id) REFERENCES customers (id);

ALTER TABLE accounts
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'current' CHECK (kind IN ('current', 'savings', 'settlement'));

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'operator', 'security_admin', 'auditor')),
  customer_id UUID REFERENCES customers (id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  -- A customer-role user must be bound to a customer record; staff users must not be.
  CONSTRAINT users_customer_binding CHECK ((role = 'customer') = (customer_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Refresh tokens are stored only as SHA-256 hashes. A token belongs to a family (one login);
-- presenting an already-used token revokes the whole family (reuse detection).
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Append-only, hash-chained audit log: each row's hash covers the previous row's hash, so
-- any edit, deletion or reordering is detectable by recomputing the chain (see
-- src/audit/chain.ts and GET /audit/verify).
CREATE TABLE audit_events (
  seq BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  ip TEXT,
  user_agent TEXT,
  correlation_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id);

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
