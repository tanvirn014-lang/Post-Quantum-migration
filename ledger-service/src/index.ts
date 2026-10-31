import { composeApplication } from "./compose.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./http/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const application = await composeApplication(config);
  const app = buildServer(application.deps);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await application.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
