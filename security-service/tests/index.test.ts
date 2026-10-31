// Single entry point for `node --test` (see ledger-service/tests/index.test.ts for why).
// These tests need PostgreSQL: they use their own `security_test` database on the server in
// TEST_DATABASE_URL / DATABASE_URL (default: the docker-compose database on localhost:5432).
import "./status.test.js";
import "./peers.test.js";
import "./config.test.js";
import "./telemetry.test.js";
import "./audit.test.js";
import "./access.test.js";
