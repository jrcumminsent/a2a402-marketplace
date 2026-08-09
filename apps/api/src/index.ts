import { buildApp } from "./app.js";

const { server, config } = await buildApp();

const shutdown = async (signal: string): Promise<void> => {
  server.log.info({ signal }, "shutdown requested");
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ port: config.port, host: config.host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
