import type { JsonValue } from "@a2a402/shared";

export type JsonSchema = Record<string, unknown>;

export interface DeliveryManifest {
  contractId: string;
  sellerAgentId: string;
  artifactUris: string[];
  artifactHashes: string[];
  outputSchema: string;
  result: unknown;
  completedAt: string;
  signature: string;
}

export interface ArtifactEvidence {
  uri: string;
  present: boolean;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export type DeterministicRuleOperator =
  | "exists"
  | "equals"
  | "not_equals"
  | "type"
  | "minimum"
  | "maximum"
  | "matches"
  | "includes"
  | "length_between"
  | "in";

export interface DeterministicRule {
  id: string;
  path: string;
  operator: DeterministicRuleOperator;
  expected?: JsonValue;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  flags?: string;
}

export interface EvaluationRequirements {
  outputJsonSchema?: JsonSchema;
  requiredFields?: string[];
  allowedMimeTypes?: string[];
  maxArtifactBytes?: number;
  deliveryDeadline?: string;
  requireSignatureVerified?: boolean;
  deterministicRules?: DeterministicRule[];
  deterministicRuleMode?: "all" | "any";
}

export interface EvaluationInput {
  delivery: DeliveryManifest;
  requirements: EvaluationRequirements;
  artifacts?: readonly ArtifactEvidence[];
  signatureVerified?: boolean;
  evaluatedAt?: string;
  metadata?: Record<string, JsonValue>;
}

export type EvaluationFindingCode =
  | "MANIFEST_INVALID"
  | "SCHEMA_INVALID"
  | "SCHEMA_VALIDATION_FAILED"
  | "REQUIRED_FIELD_MISSING"
  | "ARTIFACT_MISSING"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_MIME_INVALID"
  | "ARTIFACT_TOO_LARGE"
  | "DELIVERY_LATE"
  | "SIGNATURE_UNVERIFIED"
  | "RULE_FAILED"
  | "EVALUATOR_ERROR";

export interface EvaluationFinding {
  code: EvaluationFindingCode;
  message: string;
  path?: string;
  ruleId?: string;
  details?: Record<string, JsonValue>;
}

export interface EvaluationResult {
  evaluator: string;
  accepted: boolean;
  deterministic: boolean;
  evaluatedAt: string;
  findings: EvaluationFinding[];
  metrics: Record<string, JsonValue>;
}

export interface EvaluatorAdapter {
  readonly name: string;
  readonly deterministic: boolean;
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
