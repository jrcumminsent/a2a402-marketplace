import { describe, expect, it } from "vitest";

import { MarketplaceRuntime } from "../apps/api/src/runtime.js";
import {
  createTestEngine,
  registerActor,
} from "./helpers/marketplace-fixtures.js";

describe("MarketplaceRuntime without PostgreSQL", () => {
  it("operates in process-local mode and serializes concurrent actions", async () => {
    const engine = createTestEngine();
    const runtime = new MarketplaceRuntime(engine, {
      databaseUrl: null,
      runtimeMode: "simulation",
    });
    await runtime.initialize();

    expect(runtime.coordinator).toBeNull();
    const order: string[] = [];
    const first = runtime.runMutation(
      async () => {
        order.push("first:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        const actor = await registerActor(engine, "runtime-first", ["buyer"]);
        order.push("first:end");
        return actor.agent.id;
      },
      { mutationId: "runtime-first-mutation" },
    );
    const second = runtime.runMutation(
      async () => {
        order.push("second:start");
        const actor = await registerActor(engine, "runtime-second", ["seller"]);
        order.push("second:end");
        return actor.agent.id;
      },
      { mutationId: "runtime-second-mutation" },
    );

    const [firstId, secondId] = await Promise.all([first, second]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    await expect(
      runtime.runRead(() =>
        engine.stateView().agents.map((agent) => agent.id),
      ),
    ).resolves.toEqual(expect.arrayContaining([firstId, secondId]));
    await expect(runtime.ping()).resolves.toBe(true);
    await runtime.close();
  });
});
