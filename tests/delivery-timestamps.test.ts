import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedDeliveryManifest } from "@a2a402/marketplace";
import {
  createContractFixture,
  createTestEngine,
  signedManifest,
} from "./helpers/marketplace-fixtures.js";

const SYSTEM_TIME = "2026-08-23T04:24:20.000Z";
const RESULT = { ok: true, value: "timestamp regression" };

describe("canonical delivery completed_at validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SYSTEM_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function submitAt(completedAt: string) {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: `completed-at-${completedAt}`,
    });
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      RESULT,
      { completed_at: completedAt },
    );
    const delivery = await engine.submitDelivery(
      fixture.seller.agent.id,
      fixture.contract.id,
      manifest,
    );
    return { delivery, engine, fixture };
  }

  it.each([
    ["UTC with milliseconds", "2026-08-23T04:24:30.123Z"],
    ["UTC without milliseconds", "2026-08-23T04:24:30Z"],
    ["RFC3339 offset", "2026-08-22T23:24:30.123-05:00"],
  ])("accepts %s without rewriting the signed value", async (_label, value) => {
    const { delivery, engine, fixture } = await submitAt(value);

    expect(delivery.manifest.completed_at).toBe(value);
    expect(engine.getContract(fixture.contract.id).status).toBe("delivered");
    expect(engine.stateView().deliveries).toHaveLength(1);
  });

  it.each([
    ["malformed syntax", "not-a-timestamp"],
    ["impossible calendar date", "2026-02-30T04:24:30.123Z"],
    ["completion outside the clock-skew window", "2026-08-23T04:19:19Z"],
  ])("rejects %s and creates no delivery", async (_label, value) => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: `invalid-completed-at-${value}`,
    });
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      RESULT,
      { completed_at: value },
    );

    await expect(
      engine.submitDelivery(
        fixture.seller.agent.id,
        fixture.contract.id,
        manifest,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "completed_at is invalid.",
    });
    expect(engine.getContract(fixture.contract.id).status).toBe("active");
    expect(engine.stateView().deliveries).toHaveLength(0);
  });

  it("rejects missing completed_at as required by the delivery contract", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "missing-completed-at",
    });
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      RESULT,
    );
    delete (manifest as Partial<SignedDeliveryManifest>).completed_at;

    await expect(
      engine.submitDelivery(
        fixture.seller.agent.id,
        fixture.contract.id,
        manifest,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(engine.stateView().deliveries).toHaveLength(0);
  });

  it("still rejects an incorrect delivery signature and creates no delivery", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "invalid-timestamp-signature",
    });
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      RESULT,
      { completed_at: "2026-08-23T04:24:30.123Z" },
    );
    manifest.signature = `0x${"00".repeat(65)}`;

    await expect(
      engine.submitDelivery(
        fixture.seller.agent.id,
        fixture.contract.id,
        manifest,
      ),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(engine.getContract(fixture.contract.id).status).toBe("active");
    expect(engine.stateView().deliveries).toHaveLength(0);
  });
});
