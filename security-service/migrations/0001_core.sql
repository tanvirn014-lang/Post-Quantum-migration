-- security-service core schema: TLS profile registry, versioned configuration, peer registry,
-- sidecar telemetry and the tamper-evident audit log of configuration changes.

-- Allow-listed TLS key-agreement profiles. The sidecar may only be configured with a profile
-- that exists here; group names are validated against the provider registry in application code.
CREATE TABLE tls_profiles (
  name TEXT PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  description TEXT NOT NULL,
  groups TEXT[] NOT NULL CHECK (cardinality(groups) BETWEEN 1 AND 4),
  builtin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tls_profiles (name, description, groups, builtin) VALUES
  ('hybrid-preferred', 'Offer X25519MLKEM768 first and accept X25519 as an interoperability fallback.', ARRAY['X25519MLKEM768', 'X25519'], true),
  ('hybrid-only', 'Accept only X25519MLKEM768; classical-only clients fail the handshake.', ARRAY['X25519MLKEM768'], true),
  ('classical-baseline', 'X25519 only. Control condition for experiments; provides no post-quantum protection.', ARRAY['X25519'], true);

-- Every change to what the sidecar enforces (active profile, peer registry) appends a row, so
-- `version` is a monotonic revision the sidecar can poll, and the table doubles as a change
-- history. The active profile is carried on every row; the current one is on the latest row.
CREATE TABLE config_changes (
  version BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'tls_profile', 'peer', 'profile_registry')),
  summary TEXT NOT NULL,
  active_profile TEXT NOT NULL REFERENCES tls_profiles (name),
  actor_user_id UUID,
  actor_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO config_changes (kind, summary, active_profile) VALUES ('initial', 'Initial configuration', 'hybrid-preferred');

-- Registered external peers. Identity is the SHA-256 fingerprint of the peer's client
-- certificate (never a network address). Unregistered certificates are denied by default.
CREATE TABLE peers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,63}$'),
  description TEXT NOT NULL DEFAULT '',
  cert_sha256 TEXT NOT NULL UNIQUE CHECK (cert_sha256 ~ '^[0-9a-f]{64}$'),
  profile TEXT NOT NULL CHECK (profile IN ('hybrid-required', 'classical-allowed')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per TLS connection the sidecar evaluated. Contains no customer data or secrets.
CREATE TABLE connection_events (
  id UUID PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  remote_addr TEXT,
  peer_id UUID,
  peer_name TEXT,
  cert_sha256 TEXT,
  expected_profile TEXT CHECK (expected_profile IN ('hybrid-required', 'classical-allowed')),
  tls_version TEXT,
  cipher TEXT,
  offered_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  negotiated_group TEXT,
  negotiated_group_code INTEGER,
  key_exchange TEXT NOT NULL CHECK (key_exchange IN ('hybrid', 'classical', 'unknown')),
  client_key_share_bytes INTEGER,
  server_key_share_bytes INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('allowed-hybrid', 'allowed-fallback', 'rejected-violation', 'rejected-unknown-peer', 'handshake-failed')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  reason TEXT NOT NULL,
  handshake_ms NUMERIC(10, 3),
  config_version BIGINT NOT NULL,
  requests_forwarded INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  ack_note TEXT
);
CREATE INDEX connection_events_occurred_idx ON connection_events (occurred_at DESC);
CREATE INDEX connection_events_decision_idx ON connection_events (decision, occurred_at DESC);
CREATE INDEX connection_events_peer_idx ON connection_events (peer_id, occurred_at DESC);
CREATE INDEX connection_events_alert_idx ON connection_events (occurred_at DESC)
  WHERE severity IN ('medium', 'high', 'critical') AND acknowledged_at IS NULL;

-- Heartbeat / applied-configuration reports from sidecar instances.
CREATE TABLE sidecar_instances (
  instance_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  applied_config_version BIGINT NOT NULL,
  active_profile TEXT NOT NULL,
  runtime JSONB NOT NULL DEFAULT '{}'::jsonb,
  listener JSONB NOT NULL DEFAULT '{}'::jsonb,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE config_applications (
  id BIGSERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL,
  config_version BIGINT NOT NULL,
  profile TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX config_applications_version_idx ON config_applications (config_version, applied_at);

-- Tamper-evident audit log of configuration changes (same hash-chain design as ledger-service).
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
