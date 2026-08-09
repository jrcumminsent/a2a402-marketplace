import { sha256, type JsonValue } from "@a2a402/shared";
import { Ajv, type ErrorObject } from "ajv";
import { resolveJsonPointer } from "./json-pointer.js";
import type {
  ArtifactEvidence,
  EvaluationFinding,
  EvaluationInput,
  EvaluationResult,
  EvaluatorAdapter,
} from "./types.js";

export interface SchemaEvaluatorOptions {
  ajv?: Ajv;
  now?: () => Date;
}

function normalizeHash(value: string): string {
  return value.toLowerCase().replace(/^sha256:/, "");
}

function ajvFinding(error: ErrorObject): EvaluationFinding {
  const path = error.instancePath || "/";
  return {
    code: "SCHEMA_VALIDATION_FAILED",
    message:
      `${path} ${error.message ?? "failed JSON Schema validation"}`.trim(),
    path,
    details: {
      keyword: error.keyword,
      params: JSON.parse(JSON.stringify(error.params)) as JsonValue,
    },
  };
}

function artifactByUri(
  artifacts: readonly ArtifactEvidence[],
): ReadonlyMap<string, ArtifactEvidence> {
  return new Map(artifacts.map((artifact) => [artifact.uri, artifact]));
}

export class SchemaEvaluator implements EvaluatorAdapter {
  readonly name = "schema-evaluator";
  readonly deterministic = true;

  private readonly ajv: Ajv;
  private readonly now: () => Date;

  constructor(options: SchemaEvaluatorOptions = {}) {
    this.ajv =
      options.ajv ??
      new Ajv({
        allErrors: true,
        strict: false,
        validateFormats: false,
        allowUnionTypes: true,
      });
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const findings: EvaluationFinding[] = [];
    const evaluatedAt = input.evaluatedAt ?? this.now().toISOString();
    this.validateManifest(input, findings);
    this.validateSchema(input, findings);
    this.validateRequiredFields(input, findings);
    this.validateDeadline(input, findings);
    this.validateSignature(input, findings);
    this.validateArtifacts(input, findings);
    return {
      evaluator: this.name,
      accepted: findings.length === 0,
      deterministic: this.deterministic,
      evaluatedAt,
      findings,
      metrics: {
        artifact_count: input.delivery.artifactUris.length,
        finding_count: findings.length,
        schema_checked: Boolean(input.requirements.outputJsonSchema),
      },
    };
  }

  private validateManifest(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    const { delivery } = input;
    const requiredStrings: Array<[string, string]> = [
      ["/contractId", delivery.contractId],
      ["/sellerAgentId", delivery.sellerAgentId],
      ["/outputSchema", delivery.outputSchema],
      ["/completedAt", delivery.completedAt],
      ["/signature", delivery.signature],
    ];
    for (const [path, value] of requiredStrings) {
      if (!value.trim()) {
        findings.push({
          code: "MANIFEST_INVALID",
          message: `${path.slice(1)} is required.`,
          path,
        });
      }
    }
    if (!Number.isFinite(Date.parse(delivery.completedAt))) {
      findings.push({
        code: "MANIFEST_INVALID",
        message: "completedAt must be an ISO-8601 timestamp.",
        path: "/completedAt",
      });
    }
    if (delivery.artifactUris.length !== delivery.artifactHashes.length) {
      findings.push({
        code: "MANIFEST_INVALID",
        message: "artifactUris and artifactHashes must have equal lengths.",
        path: "/artifactHashes",
        details: {
          uri_count: delivery.artifactUris.length,
          hash_count: delivery.artifactHashes.length,
        },
      });
    }
    const duplicateUris = delivery.artifactUris.filter(
      (uri, index) => delivery.artifactUris.indexOf(uri) !== index,
    );
    if (duplicateUris.length > 0) {
      findings.push({
        code: "MANIFEST_INVALID",
        message: "Artifact URIs must be unique.",
        path: "/artifactUris",
        details: { duplicate_uris: [...new Set(duplicateUris)] },
      });
    }
  }

  private validateSchema(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    if (!input.requirements.outputJsonSchema) return;
    try {
      const validate = this.ajv.compile(input.requirements.outputJsonSchema);
      if (!validate(input.delivery.result)) {
        findings.push(...(validate.errors ?? []).map(ajvFinding));
      }
    } catch (error) {
      findings.push({
        code: "SCHEMA_INVALID",
        message:
          error instanceof Error
            ? error.message
            : "The configured output JSON Schema is invalid.",
      });
    }
  }

  private validateRequiredFields(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    for (const pointer of input.requirements.requiredFields ?? []) {
      if (!resolveJsonPointer(input.delivery.result, pointer).found) {
        findings.push({
          code: "REQUIRED_FIELD_MISSING",
          message: `Required result field ${pointer} is missing.`,
          path: pointer,
        });
      }
    }
  }

  private validateDeadline(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    const deadline = input.requirements.deliveryDeadline;
    if (!deadline) return;
    const completed = Date.parse(input.delivery.completedAt);
    const deadlineTime = Date.parse(deadline);
    if (
      Number.isFinite(completed) &&
      Number.isFinite(deadlineTime) &&
      completed > deadlineTime
    ) {
      findings.push({
        code: "DELIVERY_LATE",
        message: "Delivery was completed after the contract deadline.",
        path: "/completedAt",
        details: {
          completed_at: input.delivery.completedAt,
          deadline,
        },
      });
    }
  }

  private validateSignature(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    if (
      input.requirements.requireSignatureVerified &&
      input.signatureVerified !== true
    ) {
      findings.push({
        code: "SIGNATURE_UNVERIFIED",
        message: "The delivery manifest signature has not been verified.",
        path: "/signature",
      });
    }
  }

  private validateArtifacts(
    input: EvaluationInput,
    findings: EvaluationFinding[],
  ): void {
    const evidenceByUri = artifactByUri(input.artifacts ?? []);
    for (const [index, uri] of input.delivery.artifactUris.entries()) {
      const expectedHash = input.delivery.artifactHashes[index];
      const artifact = evidenceByUri.get(uri);
      if (!artifact?.present) {
        findings.push({
          code: "ARTIFACT_MISSING",
          message: `Artifact ${uri} is not present in storage.`,
          path: `/artifactUris/${index}`,
          details: { uri },
        });
        continue;
      }
      if (
        expectedHash &&
        (!artifact.sha256 ||
          normalizeHash(artifact.sha256) !== normalizeHash(expectedHash))
      ) {
        findings.push({
          code: "ARTIFACT_HASH_MISMATCH",
          message: `Artifact ${uri} does not match its declared SHA-256 hash.`,
          path: `/artifactHashes/${index}`,
          details: {
            uri,
            expected_sha256: normalizeHash(expectedHash),
            actual_sha256: artifact.sha256
              ? normalizeHash(artifact.sha256)
              : null,
          },
        });
      }
      const allowedMimeTypes = input.requirements.allowedMimeTypes;
      if (
        allowedMimeTypes &&
        (!artifact.mimeType || !allowedMimeTypes.includes(artifact.mimeType))
      ) {
        findings.push({
          code: "ARTIFACT_MIME_INVALID",
          message: `Artifact ${uri} has a disallowed MIME type.`,
          path: `/artifactUris/${index}`,
          details: {
            uri,
            actual_mime_type: artifact.mimeType ?? null,
            allowed_mime_types: allowedMimeTypes,
          },
        });
      }
      const maxBytes = input.requirements.maxArtifactBytes;
      if (
        maxBytes !== undefined &&
        (artifact.sizeBytes === undefined || artifact.sizeBytes > maxBytes)
      ) {
        findings.push({
          code: "ARTIFACT_TOO_LARGE",
          message: `Artifact ${uri} exceeds the maximum size or has no verified size.`,
          path: `/artifactUris/${index}`,
          details: {
            uri,
            size_bytes: artifact.sizeBytes ?? null,
            max_bytes: maxBytes,
          },
        });
      }
    }
  }
}

export function artifactEvidenceFromBytes(
  uri: string,
  bytes: Uint8Array,
  mimeType: string,
): ArtifactEvidence {
  return {
    uri,
    present: true,
    sha256: sha256(bytes),
    mimeType,
    sizeBytes: bytes.byteLength,
  };
}
