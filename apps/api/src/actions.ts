import type {
  AgentRegistration,
  JobStatus,
  ListingType,
  MarketplaceEngine,
} from "@a2a402/marketplace";
import { MarketplaceError } from "@a2a402/shared";

function requireActor(actorAgentId: string | null): string {
  if (!actorAgentId) {
    throw new MarketplaceError(
      "AUTH_REQUIRED",
      "Authentication is required.",
      401,
    );
  }
  return actorAgentId;
}

export async function executeMarketplaceAction(
  engine: MarketplaceEngine,
  actorAgentId: string | null,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (action) {
    case "register_agent":
      return engine.registerAgent(args as unknown as AgentRegistration);
    case "discover_agents":
      return engine.listAgents({
        ...(typeof args.capability === "string"
          ? { capability: args.capability }
          : {}),
      });
    case "discover_services":
      return engine.listListings({
        ...(typeof args.type === "string"
          ? {
              type: args.type as ListingType,
            }
          : {}),
        ...(typeof args.tag === "string" ? { tag: args.tag } : {}),
      });
    case "create_listing":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.createListing(
        actorAgentId,
        args as unknown as Parameters<MarketplaceEngine["createListing"]>[1],
      );
    case "purchase_listing":
      return engine.purchaseListing(
        requireActor(actorAgentId),
        String(args.listing_id),
        (args.input ?? {}) as Parameters<
          MarketplaceEngine["purchaseListing"]
        >[2],
      );
    case "post_job":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.createJob(
        actorAgentId,
        args as unknown as Parameters<MarketplaceEngine["createJob"]>[1],
      );
    case "search_jobs":
      return engine.listJobs({
        ...(typeof args.status === "string"
          ? {
              status: args.status as JobStatus,
            }
          : {}),
        ...(typeof args.capability === "string"
          ? { capability: args.capability }
          : {}),
        ...(typeof args.tag === "string" ? { tag: args.tag } : {}),
      });
    case "submit_bid":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.submitBid(
        actorAgentId,
        String(args.job_id),
        args as unknown as Parameters<MarketplaceEngine["submitBid"]>[2],
      );
    case "accept_bid":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.acceptBid(
        actorAgentId,
        String(args.job_id),
        String(args.bid_id),
      );
    case "select_bid":
      return engine.selectBestBid(
        requireActor(actorAgentId),
        String(args.job_id),
      );
    case "accept_contract":
      return engine.acceptContract(
        requireActor(actorAgentId),
        String(args.contract_id),
      );
    case "store_artifact":
      return engine.storeArtifact(
        requireActor(actorAgentId),
        args as unknown as Parameters<
          MarketplaceEngine["storeArtifact"]
        >[1],
      );
    case "deliver_artifact":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.submitDelivery(
        actorAgentId,
        String(args.contract_id),
        (args.manifest ?? args) as Parameters<
          MarketplaceEngine["submitDelivery"]
        >[2],
      );
    case "evaluate_delivery":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.evaluateDeliveryWithAdapters(
        actorAgentId,
        String(args.contract_id),
      );
    case "settle_job":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.settleContract(
        actorAgentId,
        String(args.contract_id),
        args.payment_payload,
      );
    case "get_balance":
      return engine.getBalance(
        typeof args.agent_id === "string"
          ? args.agent_id
          : requireActor(actorAgentId),
        typeof args.asset === "string" ? args.asset : undefined,
      );
    case "get_capital_provenance":
      if (typeof args.capital_lot_id === "string") {
        return engine.getProvenanceLineage(args.capital_lot_id);
      }
      return engine.getCapitalLots(
        typeof args.agent_id === "string"
          ? args.agent_id
          : requireActor(actorAgentId),
      );
    case "get_reputation":
      return engine.getReputation(
        typeof args.agent_id === "string"
          ? args.agent_id
          : requireActor(actorAgentId),
      );
    case "post_community_message":
      if (!actorAgentId) {
        throw new MarketplaceError(
          "AUTH_REQUIRED",
          "Authentication is required.",
          401,
        );
      }
      return engine.postCommunityMessage(
        actorAgentId,
        args as Parameters<MarketplaceEngine["postCommunityMessage"]>[1],
      );
    case "search_community":
      return engine.listCommunityMessages({
        ...(typeof args.channel_id === "string"
          ? { channelId: args.channel_id }
          : {}),
        ...(typeof args.tag === "string" ? { tag: args.tag } : {}),
      });
    default:
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Unknown marketplace action.",
        400,
        { action },
      );
  }
}
