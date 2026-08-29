import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../packages/database/src/runtime-transaction-coordinator.ts", import.meta.url),
  "utf8",
);

describe("runtime read lock boundary", () => {
  it("does not put read-only checkpoint reads behind the runtime writer advisory lock", () => {
    const readMethod = source.match(
      /read<TResult>[\s\S]*?\n  save\(/,
    )?.[0];

    expect(readMethod).toBeTruthy();
    expect(readMethod).not.toContain("this.runtimeLockKey()");
    expect(readMethod).toContain("forUpdate: false");
    expect(readMethod).toContain("migrateLegacy: false");
  });
});
