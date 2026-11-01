// Single entry point for `node --test`, which this project's npm script passes a literal
// file path rather than a glob (glob expansion is a shell feature, not a Node one, and
// differs between bash, PowerShell and cmd.exe). Importing each suite here for its side
// effect (registering its describe/it blocks) is enough for node:test to run all of them.
import "./domain/money.test.js";
import "./domain/ledger.test.js";
import "./app/ledger-service.test.js";
import "./app/identity-supabase.test.js";
import "./app/ledger-audit-atomicity.test.js";
import "./identity/crypto.test.js";
import "./identity/supabase-verifier.test.js";
import "./audit/chain.test.js";
import "./http/api.test.js";
import "./http/auth.test.js";
import "./http/supabase-auth.test.js";
import "./http/rbac.test.js";
import "./http/audit.test.js";
import "./http/partner.test.js";
import "./partner/replay-cache.test.js";
import "./http/cors.test.js";
import "./http/log-hygiene.test.js";
// Skip themselves unless a Postgres server is reachable - see the files for how to run them.
import "./adapters/postgres-ledger-store.integration.test.js";
import "./adapters/postgres-identity-audit.integration.test.js";
