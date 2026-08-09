import { buildApp } from "./app.js";
import { startBackgroundWorkers } from "./workers.js";

const context = await buildApp();
if (!context.config.databaseUrl) {
  await context.server.close();
  throw new Error("The standalone worker requires DATABASE_URL.");
}
if (!context.config.backgroundWorkersEnabled) {
  await context.server.close();
  throw new Error(
    "Set BACKGROUND_WORKERS_ENABLED=true to start the standalone worker.",
  );
}

const workers = startBackgroundWorkers(
  context.engine,
  context.config,
  context.runtime,
);

const shutdown = async (): Promise<void> => {
  workers.stop();
  await context.server.close();
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

console.log(
  JSON.stringify({
    level: "info",
    event: "a2a402_worker_started",
    interval_ms: context.config.workerIntervalMs,
  }),
);
