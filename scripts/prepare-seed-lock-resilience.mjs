import { readFile, writeFile } from "node:fs/promises";

const path = "apps/api/src/app.ts";
let source = await readFile(path, "utf8");

const oldBlock = `    if (config.seedSimulationOpportunities) {\n      await ensureSimulationSeedOpportunities(engine, runtime);\n    }`;

const newBlock = `    if (config.seedSimulationOpportunities) {\n      try {\n        await ensureSimulationSeedOpportunities(engine, runtime);\n      } catch (error) {\n        const message = error instanceof Error ? error.message : String(error);\n        const lockContention =\n          message.includes("lock timeout") ||\n          message.includes("could not obtain lock") ||\n          message.includes("canceling statement due to lock timeout");\n        if (!lockContention) throw error;\n        // Another cold-started instance may already be seeding the same durable\n        // simulation state. Seeding is idempotent, so do not take the public API\n        // down merely because this instance lost the advisory-lock race. A later\n        // cold start can retry any seed work that was not committed.\n        console.warn("Simulation seed skipped because another runtime holds the database lock.", {\n          error: message,\n        });\n      }\n    }`;

if (!source.includes(oldBlock) && !source.includes("Simulation seed skipped because another runtime holds the database lock.")) {
  throw new Error("Could not locate simulation seed startup block.");
}

source = source.replace(oldBlock, newBlock);
await writeFile(path, source);
console.log("Prepared seed lock-contention resilience.");
