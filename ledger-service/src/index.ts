import { LedgerService } from "./app/ledger-service.js";
import { MemoryLedgerStore } from "./adapters/memory/ledger-store.js";
import { createPool } from "./adapters/postgres/db.js";
import { PostgresLedgerStore } from "./adapters/postgres/ledger-store.js";
import type { LedgerStore } from "./ports/ledger-store.js";
import { buildServer } from "./http/server.js";

function createStore(): LedgerStore {
  const kind = process.env["LEDGER_STORE"] ?? "memory";
  if (kind === "postgres") {
    return new PostgresLedgerStore(createPool());
  }
  if (kind === "memory") {
    console.warn(
      "LEDGER_STORE=memory - using the in-process store. This does not persist across " +
        "restarts and is not for production use. Set LEDGER_STORE=postgres + DATABASE_URL " +
        "for a real deployment.",
    );
    return new MemoryLedgerStore();
  }
  throw new Error(`Unknown LEDGER_STORE "${kind}", expected "memory" or "postgres"`);
}

async function main(): Promise<void> {
  const store = createStore();
  const service = new LedgerService(store);
  const app = buildServer(service);

  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";
  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
