-- Stored educational HNDL simulator runs and ingested benchmark evidence.

CREATE TABLE hndl_runs (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  quantum_assumption TEXT NOT NULL CHECK (quantum_assumption IN ('none', 'x25519-broken', 'both-broken')),
  -- The full simulator output (a toy message and real ciphertext captured from throw-away keys).
  result JSONB NOT NULL
);
CREATE INDEX hndl_runs_created_idx ON hndl_runs (created_at DESC);

-- Benchmark runs are evidence: one row per run id, never updated (a trigger refuses it).
CREATE TABLE benchmark_runs (
  run_id TEXT PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9._-]{8,80}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label TEXT NOT NULL,
  source_commit TEXT,
  working_tree_dirty BOOLEAN,
  manifest JSONB NOT NULL,
  summary JSONB NOT NULL,
  handshakes_csv TEXT NOT NULL,
  handshakes_csv_sha256 TEXT NOT NULL CHECK (handshakes_csv_sha256 ~ '^[0-9a-f]{64}$'),
  throughput_csv TEXT NOT NULL,
  throughput_csv_sha256 TEXT NOT NULL CHECK (throughput_csv_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX benchmark_runs_received_idx ON benchmark_runs (received_at DESC);

CREATE FUNCTION benchmark_runs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'benchmark_runs is append-only evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER benchmark_runs_no_update BEFORE UPDATE OR DELETE ON benchmark_runs
  FOR EACH ROW EXECUTE FUNCTION benchmark_runs_immutable();
