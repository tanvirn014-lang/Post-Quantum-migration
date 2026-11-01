-- Supabase add-on identity layer: link a local user to a Supabase account.
-- The core keeps owning roles, ownership and the audit chain; this column only records which
-- Supabase identity (if any) a user authenticates through. Local accounts leave it NULL.

ALTER TABLE users ADD COLUMN supabase_user_id UUID;

-- At most one local user per Supabase identity; many local accounts have none (partial index so
-- multiple NULLs are allowed).
CREATE UNIQUE INDEX users_supabase_user_id_key ON users (supabase_user_id) WHERE supabase_user_id IS NOT NULL;
