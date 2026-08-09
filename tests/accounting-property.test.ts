import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createTestEngine,
  registerActor,
  standardJobInput,
} from "./helpers/marketplace-fixtures.js";

describe("property-based accounting invariants", () => {
  it("preserves lot totals and balanced entries across arbitrary partial reservations and refunds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 500_000 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (requestedNumber, lotNumbers) => {
          const engine = createTestEngine();
          const buyer = await registerActor(engine, "property-buyer", [
            "buyer",
          ]);
          const seller = await registerActor(engine, "property-seller", [
            "seller",
          ]);
          const requested = BigInt(requestedNumber);
          const lots = lotNumbers.map(BigInt);
          const existing = lots.reduce((sum, amount) => sum + amount, 0n);
          if (existing < requested) lots.push(requested - existing + 1n);
          for (const amount of lots) {
            engine.importCapital({
              agentId: buyer.agent.id,
              amountMinor: amount,
              originType: "platform_test_funds",
            });
          }
          const funded = lots.reduce((sum, amount) => sum + amount, 0n);
          const job = engine.createJob(
            buyer.agent.id,
            standardJobInput(requested),
          );
          const bid = engine.submitBid(seller.agent.id, job.id, {
            amount_minor: requested,
            execution_seconds: 30,
            proposal: {},
          });
          const contract = await engine.acceptBid(
            buyer.agent.id,
            job.id,
            bid.id,
          );
          const reserved = engine.stateView().reservations[0];
          expect(
            reserved?.allocations.reduce(
              (sum, allocation) => sum + allocation.amountMinor,
              0n,
            ),
          ).toBe(requested);
          expect(engine.getBalance(buyer.agent.id)).toMatchObject({
            eligibleAvailableMinor: funded - requested,
            eligibleReservedMinor: requested,
          });
          await engine.refundContract(
            buyer.agent.id,
            contract.id,
            "property_test_refund",
          );
          expect(engine.getBalance(buyer.agent.id)).toMatchObject({
            eligibleAvailableMinor: funded,
            eligibleReservedMinor: 0n,
          });
          const lotTotal = engine
            .getCapitalLots(buyer.agent.id)
            .reduce(
              (sum, lot) => sum + lot.availableMinor + lot.reservedMinor,
              0n,
            );
          expect(lotTotal).toBe(funded);
          expect(engine.assertAccountingInvariants()).toMatchObject({
            nonnegativeCapitalLots: true,
            nonnegativeAgentBalances: true,
          });
        },
      ),
      { numRuns: 25 },
    );
  });
});
