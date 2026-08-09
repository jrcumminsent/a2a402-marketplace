import type { MarketplaceEngine } from "@a2a402/marketplace";
import {
  deliverWebhookSafely,
  type JsonValue,
} from "@a2a402/shared";
import type { AppConfig } from "./config.js";
import type { MarketplaceRuntime } from "./runtime.js";

export interface WorkerTickReport {
  timeouts: Awaited<ReturnType<MarketplaceEngine["processTimeouts"]>>;
  outbox: Awaited<ReturnType<MarketplaceEngine["dispatchOutbox"]>>;
}

export async function runWorkerTick(
  engine: MarketplaceEngine,
  config: AppConfig,
  runtime: MarketplaceRuntime,
): Promise<WorkerTickReport> {
  const tickId = new Date().toISOString();
  const timeouts = await runtime.runMutation(
    () => engine.processTimeouts(),
    {
      mutationId: `worker:timeouts:${tickId}`,
      lockKeys: ["worker:timeouts"],
    },
  );
  const outbox = await runtime.runMutation(
    () =>
      engine.dispatchOutbox(
        async ({
          subscription,
          event,
          deliveryId,
          timestamp,
          signature,
        }) => {
          const envelope: JsonValue = {
            version: "a2a402-webhook/0.1",
            delivery_id: deliveryId,
            delivered_at: timestamp,
            event: {
              id: event.id,
              sequence: event.sequence,
              type: event.type,
              aggregate_type: event.aggregateType,
              aggregate_id: event.aggregateId,
              payload: event.payload,
              marketplace_signature: event.signature,
              created_at: event.createdAt,
            },
          };
          await deliverWebhookSafely(
            subscription.url,
            envelope,
            {
              "x-a2a402-delivery-id": deliveryId,
              "x-a2a402-timestamp": timestamp,
              "x-a2a402-signature": signature,
              "x-a2a402-event": event.type,
            },
            {
              allowHttp: config.engine.simulationMode,
              allowPrivateNetwork: config.engine.simulationMode,
              timeoutMs: 5_000,
              maximumResponseBytes: 65_536,
            },
          );
          return true;
        },
        (subscriptionId) => engine.resolveWebhookSecret(subscriptionId),
      ),
    {
      mutationId: `worker:outbox:${tickId}`,
      lockKeys: ["worker:outbox"],
    },
  );
  return { timeouts, outbox };
}

export function startBackgroundWorkers(
  engine: MarketplaceEngine,
  config: AppConfig,
  runtime: MarketplaceRuntime,
  onError: (error: unknown) => void = (error) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "background_worker_failed",
        message:
          error instanceof Error ? error.message : "Unknown worker failure",
      }),
    );
  },
): { stop(): void } {
  let stopped = false;
  let running = false;
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await runWorkerTick(engine, config, runtime);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), config.workerIntervalMs);
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
