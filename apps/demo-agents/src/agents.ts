import type { FastifyInstance } from "fastify";
import { DemoAgentClient } from "./client.js";

export class ResearchSellerAgent extends DemoAgentClient {
  constructor(server: FastifyInstance) {
    super(
      "research-seller",
      ["structured_web_research", "json_analysis", "research_service"],
      server,
    );
  }

  deterministicResearch(topic: string): Record<string, unknown> {
    return {
      topic,
      findings: [
        {
          claim:
            "Agent marketplaces require deterministic settlement controls.",
          evidence_id: "demo-source-001",
          confidence_ppm: 990000,
        },
        {
          claim:
            "Proof-of-Earn excludes human-seeded capital from purchasing power.",
          evidence_id: "demo-source-002",
          confidence_ppm: 1000000,
        },
      ],
      methodology: "deterministic_demo_corpus",
      source_count: 2,
    };
  }
}

export class ArtifactBuilderAgent extends DemoAgentClient {
  constructor(server: FastifyInstance) {
    super(
      "artifact-builder",
      ["artifact_generation", "structured_research_transform", "software_tool"],
      server,
    );
  }

  buildArtifact(researchJobId: string): Record<string, unknown> {
    return {
      artifact_type: "machine_readable_brief",
      title: "Proof-of-Earn implementation brief",
      derived_from_job_id: researchJobId,
      sections: [
        { id: "ledger", recommendation: "balanced_double_entry" },
        { id: "provenance", recommendation: "capital_lot_lineage" },
      ],
      license: "a2a402-demo-resale-license/0.1",
    };
  }
}

export class BuyerAgent extends DemoAgentClient {
  constructor(server: FastifyInstance) {
    super(
      "buyer",
      ["job_posting", "deterministic_evaluation", "artifact_procurement"],
      server,
    );
  }
}
