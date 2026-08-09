export type RuntimeMode = "simulation" | "real";

export type RuntimeCoordinatorErrorCode =
  | "RUNTIME_MODE_MISMATCH"
  | "RUNTIME_SIMULATION_STATE_FORBIDDEN"
  | "RUNTIME_LEGACY_MODE_UNKNOWN"
  | "RUNTIME_STATE_STALE"
  | "RUNTIME_STATE_CORRUPT"
  | "RUNTIME_SERIALIZATION_RETRY_EXHAUSTED"
  | "RUNTIME_COORDINATOR_CLOSED"
  | "NORMALIZED_WRITE_CONFLICT"
  | "NORMALIZED_WRITE_INVALID";

export class RuntimeCoordinatorError extends Error {
  constructor(
    readonly code: RuntimeCoordinatorErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "RuntimeCoordinatorError";
  }
}

export function runtimeModeFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeMode {
  const explicit = environment.A2A402_RUNTIME_MODE?.trim().toLowerCase();
  if (explicit) {
    if (explicit === "simulation" || explicit === "real") {
      return explicit;
    }
    throw new RuntimeCoordinatorError(
      "RUNTIME_MODE_MISMATCH",
      "A2A402_RUNTIME_MODE must be simulation or real.",
      { configured_mode: explicit },
    );
  }

  const paymentsMode = (environment.PAYMENTS_MODE ?? "mock")
    .trim()
    .toLowerCase();
  if (paymentsMode === "mock") {
    return "simulation";
  }
  if (paymentsMode === "x402-testnet") {
    return "real";
  }

  throw new RuntimeCoordinatorError(
    "RUNTIME_MODE_MISMATCH",
    "Runtime mode cannot be inferred from PAYMENTS_MODE.",
    { payments_mode: paymentsMode },
  );
}

interface SimulationMarker {
  path: string;
  reason: string;
}

function findSimulationMarker(
  value: unknown,
  path: string,
  visited: Set<object>,
): SimulationMarker | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (visited.has(value)) {
    return null;
  }
  visited.add(value);

  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      record.originType === "platform_test_funds" ||
      record.origin_type === "platform_test_funds"
    ) {
      return { path, reason: "simulation capital origin" };
    }
    if (
      record.provenanceScope === "simulation" ||
      record.provenance_scope === "simulation"
    ) {
      return { path, reason: "simulation provenance scope" };
    }
    const declaredMode = record.runtimeMode ?? record.runtime_mode;
    if (
      declaredMode === "simulation" ||
      record.simulationMode === true ||
      record.simulation_mode === true
    ) {
      return { path, reason: "snapshot declares simulation mode" };
    }

    const paymentAdapter =
      record.paymentAdapter ??
      record.payment_adapter ??
      (("transactionHash" in record || "paymentIdentifier" in record) &&
      "adapter" in record
        ? record.adapter
        : undefined);
    if (paymentAdapter === "mock") {
      return { path, reason: "mock payment evidence" };
    }
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSimulationMarker(
        value[index],
        `${path}[${index}]`,
        visited,
      );
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const found = findSimulationMarker(child, `${path}.${key}`, visited);
    if (found) return found;
  }
  return null;
}

function declaredRuntimeMode(snapshot: unknown): RuntimeMode | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const record = snapshot as Record<string, unknown>;
  const value = record.runtimeMode ?? record.runtime_mode;
  return value === "simulation" || value === "real" ? value : null;
}

/**
 * Rejects cross-mode state before any checkpoint write. Database metadata is
 * the primary boundary; scanning also prevents a new real-mode checkpoint from
 * being initialized with known mock capital or payment evidence.
 */
export function assertRuntimeSnapshotCompatible(
  snapshot: unknown,
  runtimeMode: RuntimeMode,
): void {
  const declared = declaredRuntimeMode(snapshot);
  if (declared && declared !== runtimeMode) {
    throw new RuntimeCoordinatorError(
      "RUNTIME_MODE_MISMATCH",
      "Snapshot-declared runtime mode does not match the coordinator.",
      { expected_mode: runtimeMode, snapshot_mode: declared },
    );
  }

  if (runtimeMode !== "real") {
    return;
  }

  const marker = findSimulationMarker(snapshot, "$", new Set());
  if (marker) {
    throw new RuntimeCoordinatorError(
      "RUNTIME_SIMULATION_STATE_FORBIDDEN",
      "Real-value runtime state cannot contain simulation capital or payment evidence.",
      { path: marker.path, reason: marker.reason },
    );
  }
}
