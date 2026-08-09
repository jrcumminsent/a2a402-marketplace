import { describe, expect, it } from "vitest";
import {
  CompositeEvaluator,
  DeterministicRuleEvaluator,
  MockAgentEvaluator,
  SchemaEvaluator,
  artifactEvidenceFromBytes,
  type DeliveryManifest,
} from "../src/index.js";
import { createHash } from "node:crypto";

const bytes = Buffer.from('{"answer":42}');
const hash = createHash("sha256").update(bytes).digest("hex");
const delivery: DeliveryManifest = {
  contractId: "contract-1",
  sellerAgentId: "seller-1",
  artifactUris: ["artifact://result"],
  artifactHashes: [hash],
  outputSchema: "result-v1",
  result: { answer: 42, citations: ["source"] },
  completedAt: "2026-07-24T12:00:00.000Z",
  signature: "signed",
};

describe("delivery evaluators", () => {
  it("accepts schema-compliant, timely, hash-verified delivery", async () => {
    const evaluator = new SchemaEvaluator();
    const result = await evaluator.evaluate({
      delivery,
      signatureVerified: true,
      artifacts: [
        artifactEvidenceFromBytes(
          "artifact://result",
          bytes,
          "application/json",
        ),
      ],
      requirements: {
        outputJsonSchema: {
          type: "object",
          required: ["answer", "citations"],
          properties: {
            answer: { type: "integer" },
            citations: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
          additionalProperties: false,
        },
        requiredFields: ["/answer", "/citations/0"],
        allowedMimeTypes: ["application/json"],
        maxArtifactBytes: 100,
        deliveryDeadline: "2026-07-24T12:01:00.000Z",
        requireSignatureVerified: true,
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("rejects schema, hash, MIME, size, signature, and deadline failures", async () => {
    const evaluator = new SchemaEvaluator();
    const result = await evaluator.evaluate({
      delivery: {
        ...delivery,
        result: { answer: "wrong" },
        completedAt: "2026-07-24T13:00:00.000Z",
      },
      signatureVerified: false,
      artifacts: [
        {
          uri: "artifact://result",
          present: true,
          sha256: "bad",
          mimeType: "text/plain",
          sizeBytes: 1_000,
        },
      ],
      requirements: {
        outputJsonSchema: {
          type: "object",
          required: ["answer", "citations"],
          properties: { answer: { type: "integer" } },
        },
        requiredFields: ["/citations"],
        allowedMimeTypes: ["application/json"],
        maxArtifactBytes: 100,
        deliveryDeadline: "2026-07-24T12:01:00.000Z",
        requireSignatureVerified: true,
      },
    });
    expect(result.accepted).toBe(false);
    expect(new Set(result.findings.map((finding) => finding.code))).toEqual(
      new Set([
        "SCHEMA_VALIDATION_FAILED",
        "REQUIRED_FIELD_MISSING",
        "ARTIFACT_HASH_MISMATCH",
        "ARTIFACT_MIME_INVALID",
        "ARTIFACT_TOO_LARGE",
        "DELIVERY_LATE",
        "SIGNATURE_UNVERIFIED",
      ]),
    );
  });

  it("runs deterministic rules without evaluating arbitrary code", async () => {
    const evaluator = new DeterministicRuleEvaluator();
    const accepted = await evaluator.evaluate({
      delivery,
      requirements: {
        deterministicRules: [
          { id: "answer", path: "/answer", operator: "equals", expected: 42 },
          {
            id: "citation-count",
            path: "/citations",
            operator: "length_between",
            minimum: 1,
            maximum: 5,
          },
          {
            id: "citation-pattern",
            path: "/citations/0",
            operator: "matches",
            pattern: "^source$",
          },
        ],
      },
    });
    expect(accepted.accepted).toBe(true);
  });

  it("composes mandatory deterministic and optional mock-agent checks", async () => {
    const evaluator = new CompositeEvaluator([
      new SchemaEvaluator(),
      new MockAgentEvaluator({ accepted: false }),
    ]);
    const result = await evaluator.evaluate({
      delivery,
      artifacts: [
        {
          uri: "artifact://result",
          present: true,
          sha256: hash,
          mimeType: "application/json",
          sizeBytes: bytes.byteLength,
        },
      ],
      requirements: {},
    });
    expect(result.accepted).toBe(false);
  });
});
