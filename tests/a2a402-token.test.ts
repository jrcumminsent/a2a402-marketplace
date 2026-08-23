import { describe, expect, it } from "vitest";
import { compileA2A402Token } from "../scripts/compile-token.js";

describe("A2A402 fixed-supply token", () => {
  it("compiles with the conventional ERC-20 surface and no mint/admin surface", () => {
    const compiled = compileA2A402Token();
    const functions = compiled.abi
      .filter(
        (entry): entry is { type: "function"; name: string } =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { type?: string }).type === "function",
      )
      .map((entry) => entry.name);
    expect(compiled.bytecode.length).toBeGreaterThan(2);
    expect(functions).toEqual(
      expect.arrayContaining([
        "name",
        "symbol",
        "decimals",
        "totalSupply",
        "balanceOf",
        "transfer",
        "allowance",
        "approve",
        "transferFrom",
        "MAX_SUPPLY",
      ]),
    );
    expect(functions).not.toEqual(
      expect.arrayContaining([
        "mint",
        "burn",
        "pause",
        "blacklist",
        "seize",
        "upgradeTo",
        "owner",
      ]),
    );
  });

  it("uses an exact one-billion-token allocation totaling 100 percent", () => {
    const allocations = [
      400_000_000n,
      250_000_000n,
      150_000_000n,
      100_000_000n,
      50_000_000n,
      50_000_000n,
    ];
    expect(allocations.reduce((sum, value) => sum + value, 0n)).toBe(
      1_000_000_000n,
    );
    expect(allocations.map((value) => Number(value / 10_000_000n))).toEqual([
      40, 25, 15, 10, 5, 5,
    ]);
  });
});
