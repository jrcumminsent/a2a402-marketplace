import { canonicalJson, nowIso, sha256, uuid } from "@a2a402/shared";

export type ReputationEventType =
  | "contract_completed"
  | "contract_failed"
  | "refund"
  | "dispute"
  | "schema_compliant"
  | "schema_noncompliant"
  | "on_time"
  | "late"
  | "policy_violation"
  | "evaluation_accurate"
  | "repeat_buyer";

export interface ReputationEvent {
  id: string;
  agentId: string;
  counterpartyAgentId: string | null;
  contractId: string | null;
  type: ReputationEventType;
  amountMinor: bigint | null;
  durationMs: number | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface RiskFlag {
  code:
    | "CIRCULAR_TRANSACTION_PATTERN"
    | "RECIPROCAL_TRADING"
    | "REUSED_ARTIFACT"
    | "IDENTICAL_OUTPUT"
    | "RAPID_BALANCE_CYCLING"
    | "SHARED_WALLET_RELATIONSHIP"
    | "LOW_ARTIFACT_VALUE";
  severity: "low" | "medium" | "high";
  explanation: string;
  evidenceIds: string[];
}

export interface ReputationSnapshot {
  agentId: string;
  completedContracts: number;
  failedContracts: number;
  refundRatePpm: number;
  disputeRatePpm: number;
  schemaComplianceRatePpm: number;
  onTimeDeliveryRatePpm: number;
  medianResponseTimeMs: number | null;
  medianExecutionTimeMs: number | null;
  totalVerifiedEarningsMinor: bigint;
  repeatBuyerRatePpm: number;
  evaluationAccuracyPpm: number;
  policyViolations: number;
  capitalProvenanceQualityPpm: number;
  riskFlags: RiskFlag[];
  generatedAt: string;
  digest: string;
  signature?: string;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : Math.round((numerator * 1_000_000) / denominator);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export function createReputationEvent(
  input: Omit<ReputationEvent, "id" | "createdAt">,
): ReputationEvent {
  return { ...input, id: uuid(), createdAt: nowIso() };
}

export function computeReputation(
  agentId: string,
  events: ReputationEvent[],
  riskFlags: RiskFlag[] = [],
): ReputationSnapshot {
  const own = events.filter((event) => event.agentId === agentId);
  const count = (type: ReputationEventType) =>
    own.filter((event) => event.type === type).length;
  const completed = count("contract_completed");
  const failed = count("contract_failed");
  const outcomes = completed + failed;
  const compliant = count("schema_compliant");
  const noncompliant = count("schema_noncompliant");
  const onTime = count("on_time");
  const late = count("late");
  const earned = own
    .filter((event) => event.type === "contract_completed")
    .reduce((sum, event) => sum + (event.amountMinor ?? 0n), 0n);
  const generatedAt = nowIso();
  const unsigned = {
    agentId,
    completedContracts: completed,
    failedContracts: failed,
    refundRatePpm: rate(count("refund"), Math.max(outcomes, 1)),
    disputeRatePpm: rate(count("dispute"), Math.max(outcomes, 1)),
    schemaComplianceRatePpm: rate(compliant, compliant + noncompliant),
    onTimeDeliveryRatePpm: rate(onTime, onTime + late),
    medianResponseTimeMs: median(
      own
        .filter(
          (event) => event.type === "repeat_buyer" && event.durationMs !== null,
        )
        .map((event) => event.durationMs as number),
    ),
    medianExecutionTimeMs: median(
      own
        .filter(
          (event) =>
            ["on_time", "late"].includes(event.type) &&
            event.durationMs !== null,
        )
        .map((event) => event.durationMs as number),
    ),
    totalVerifiedEarningsMinor: earned,
    repeatBuyerRatePpm: rate(count("repeat_buyer"), Math.max(completed, 1)),
    evaluationAccuracyPpm: rate(
      count("evaluation_accurate"),
      Math.max(completed, 1),
    ),
    policyViolations: count("policy_violation"),
    capitalProvenanceQualityPpm:
      completed === 0 ? 0 : Math.max(0, 1_000_000 - riskFlags.length * 100_000),
    riskFlags,
    generatedAt,
  };
  return { ...unsigned, digest: sha256(canonicalJson(unsigned)) };
}
