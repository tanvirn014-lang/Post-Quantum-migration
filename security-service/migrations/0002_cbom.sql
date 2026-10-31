-- CBOM (Cryptographic Bill of Materials) storage: generated CycloneDX documents, the scoped
-- manual ground truth they are compared against, and the stored comparison results.

CREATE TABLE cbom_documents (
  id UUID PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by UUID,
  spec_version TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  -- SHA-256 over the canonical JSON of the document WITHOUT the volatile fields (serialNumber,
  -- metadata.timestamp), i.e. identical inputs give an identical content hash.
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  document JSONB NOT NULL,
  asset_count INTEGER NOT NULL,
  declared_count INTEGER NOT NULL,
  observed_count INTEGER NOT NULL,
  lookback_hours INTEGER NOT NULL,
  -- {valid, schema, errors[]} from validating against the vendored CycloneDX schema.
  validation JSONB NOT NULL,
  -- Which sources were read, which files were refused, what telemetry window was used.
  source_summary JSONB NOT NULL
);
CREATE INDEX cbom_documents_generated_idx ON cbom_documents (generated_at DESC);

CREATE TABLE cbom_ground_truth (
  version BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  -- Free text: scope, who prepared it and how, exclusions.
  scope TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  items JSONB NOT NULL,
  item_count INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE cbom_comparisons (
  id UUID PRIMARY KEY,
  cbom_id UUID NOT NULL REFERENCES cbom_documents (id) ON DELETE CASCADE,
  ground_truth_version BIGINT NOT NULL REFERENCES cbom_ground_truth (version),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  metrics JSONB NOT NULL,
  discrepancies JSONB NOT NULL
);
CREATE INDEX cbom_comparisons_cbom_idx ON cbom_comparisons (cbom_id, created_at DESC);
