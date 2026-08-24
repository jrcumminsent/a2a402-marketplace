import { readFile, writeFile } from "node:fs/promises";

const path = "apps/api/src/simulation-seed.ts";
let source = await readFile(path, "utf8");

const marker = "] as const;\n\nconst GENESIS_JOB = JOBS[0];";
if (!source.includes(marker)) throw new Error("Could not locate persistent seed job list.");

if (!source.includes('title: "Beginner: return a fixed JSON acknowledgement"')) {
  const beginnerJobs = `  {\n    title: "Beginner: return a fixed JSON acknowledgement",\n    description:\n      "TEST ONLY starter job. Return the requested fixed JSON acknowledgement exactly as described by the output schema.",\n    budget_minor: "50000",\n    required_capabilities: [],\n    tags: ["beginner", "starter-job", "test-only", "deterministic"],\n    input: { message: "A2A402_READY" },\n    output_schema: {\n      type: "object",\n      required: ["acknowledged", "message"],\n      properties: {\n        acknowledged: { const: true },\n        message: { const: "A2A402_READY" },\n      },\n      additionalProperties: false,\n    },\n    acceptance_rules: [\n      { path: "$.acknowledged", operator: "equals", value: true },\n      { path: "$.message", operator: "equals", value: "A2A402_READY" },\n    ],\n  },\n  {\n    title: "Beginner: add three integers",\n    description:\n      "TEST ONLY starter job. Add the supplied integers and return the deterministic JSON result.",\n    budget_minor: "50000",\n    required_capabilities: [],\n    tags: ["beginner", "starter-job", "test-only", "arithmetic"],\n    input: { values: [7, 11, 24] },\n    output_schema: {\n      type: "object",\n      required: ["sum"],\n      properties: { sum: { const: 42 } },\n      additionalProperties: false,\n    },\n    acceptance_rules: [{ path: "$.sum", operator: "equals", value: 42 }],\n  },\n  {\n    title: "Beginner: uppercase a phrase",\n    description:\n      "TEST ONLY starter job. Uppercase the supplied phrase and return it in one JSON field.",\n    budget_minor: "50000",\n    required_capabilities: [],\n    tags: ["beginner", "starter-job", "test-only", "text"],\n    input: { text: "hello agents" },\n    output_schema: {\n      type: "object",\n      required: ["text"],\n      properties: { text: { const: "HELLO AGENTS" } },\n      additionalProperties: false,\n    },\n    acceptance_rules: [{ path: "$.text", operator: "equals", value: "HELLO AGENTS" }],\n  },\n  {\n    title: "Beginner: extract two fields",\n    description:\n      "TEST ONLY starter job. Return only the requested fields from the supplied object.",\n    budget_minor: "50000",\n    required_capabilities: [],\n    tags: ["beginner", "starter-job", "test-only", "json"],\n    input: { source: { agent: "worker", task: "extract", ignore: "x" }, fields: ["agent", "task"] },\n    output_schema: {\n      type: "object",\n      required: ["agent", "task"],\n      properties: {\n        agent: { const: "worker" },\n        task: { const: "extract" },\n      },\n      additionalProperties: false,\n    },\n    acceptance_rules: [\n      { path: "$.agent", operator: "equals", value: "worker" },\n      { path: "$.task", operator: "equals", value: "extract" },\n    ],\n  },\n  {\n    title: "Beginner: identify the test environment",\n    description:\n      "TEST ONLY starter job. Confirm that the current marketplace asset is non-fiat test value and return the fixed classification.",\n    budget_minor: "50000",\n    required_capabilities: [],\n    tags: ["beginner", "starter-job", "test-only", "classification"],\n    input: { statement: "This environment is for testing and does not represent fiat-redeemable value." },\n    output_schema: {\n      type: "object",\n      required: ["classification", "real_money"],\n      properties: {\n        classification: { const: "TEST_ONLY" },\n        real_money: { const: false },\n      },\n      additionalProperties: false,\n    },\n    acceptance_rules: [\n      { path: "$.classification", operator: "equals", value: "TEST_ONLY" },\n      { path: "$.real_money", operator: "equals", value: false },\n    ],\n  },\n`;
  source = source.replace(marker, beginnerJobs + marker);
}

const fundingAnchor = `      const storedDesignation = engine.getCanonicalSeededGenesisDesignation();`;
if (!source.includes(fundingAnchor)) throw new Error("Could not locate seed funding anchor.");
if (!source.includes("test:a2a402-seeded-opportunities-beginner-v5")) {
  const funding = `      const beginnerFundingHash =\n        "test:a2a402-seeded-opportunities-beginner-v5";\n      if (\n        !engine\n          .stateView()\n          .capitalLots.some(\n            (lot) => lot.sourceTransactionHash === beginnerFundingHash,\n          )\n      ) {\n        engine.importCapital({\n          agentId: buyer.id,\n          amountMinor: "500000",\n          asset: "USDC",\n          originType: "platform_test_funds",\n          provenanceScope: "simulation",\n          sourceTransactionHash: beginnerFundingHash,\n        });\n      }\n\n`;
  source = source.replace(fundingAnchor, funding + fundingAnchor);
}

source = source.replace(
  'mutationId: "simulation-seed-opportunities:v4"',
  'mutationId: "simulation-seed-opportunities:v5"',
);

await writeFile(path, source);
console.log("Prepared capability-free beginner persistent jobs.");
