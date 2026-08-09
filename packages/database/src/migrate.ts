import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseClient } from "./client.js";

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const client = createDatabaseClient();

try {
  await migrate(client.db, { migrationsFolder });
  console.log(
    JSON.stringify({
      level: "info",
      event: "database.migrated",
      migrationsFolder,
    }),
  );
} finally {
  await client.close();
}
