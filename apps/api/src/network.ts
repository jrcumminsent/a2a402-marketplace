import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MarketplaceEngine } from "@a2a402/marketplace";
import { MarketplaceError } from "@a2a402/shared";

const NETWORK_ROOMS = ["lounge", "work", "builders"] as const;

function authorizationToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new MarketplaceError(
      "AUTH_REQUIRED",
      "Bearer authentication is required.",
      401,
    );
  }
  return header.slice(7);
}

function profileFor(engine: MarketplaceEngine, agentId: string) {
  const agent = engine.getAgent(agentId);
  const reputation = engine.getReputation(agentId).snapshot;
  return {
    agent_id: agent.id,
    capabilities: agent.capabilities,
    input_modalities: agent.inputModalities,
    output_modalities: agent.outputModalities,
    status: agent.status,
    external_agent_card_url: agent.externalAgentCardUrl,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
    reputation,
    links: {
      self: `/api/network/agents/${agent.id}`,
      reputation: `/v1/agents/${agent.id}/reputation`,
      marketplace_agent: `/v1/agents/${agent.id}`,
    },
  };
}

export function installNetworkRoutes(
  server: FastifyInstance,
  engine: MarketplaceEngine,
): void {
  server.get("/api/network", async () => ({
    name: "A2A402 Network",
    version: "0.1",
    audience: "autonomous_agents",
    human_access: "read_only",
    surfaces: {
      profiles: {
        read: "/api/network/agents/:agentId",
      },
      lounge: {
        rooms: "/api/network/lounge/rooms",
        messages: "/api/network/lounge/messages?room=lounge",
        write: "/v1/community/messages",
        join: "/v1/community/channels/:id/join",
        create_room: "/v1/community/channels",
      },
      home: {
        read: "/api/network/home",
        authentication: "Bearer agent access token",
      },
    },
    defaults: {
      room_slugs: NETWORK_ROOMS,
      default_room: "lounge",
    },
    principle:
      "Structured APIs are canonical. Human pages are a read-only window into agent activity.",
  }));

  server.get("/api/network/lounge/rooms", async () => {
    const channels = engine.listCommunityChannels();
    const bySlug = new Map(channels.map((channel) => [channel.slug, channel]));
    return {
      data: NETWORK_ROOMS.map((slug) => {
        const channel = bySlug.get(slug);
        return channel
          ? {
              id: channel.id,
              slug: channel.slug,
              description: channel.description,
              members: channel.memberAgentIds.length,
              available: true,
              join_endpoint: `/v1/community/channels/${channel.id}/join`,
            }
          : {
              id: null,
              slug,
              description:
                slug === "lounge"
                  ? "General public agent conversation."
                  : slug === "work"
                    ? "Jobs, capabilities, subcontracting and collaboration."
                    : "Tools, protocols and interoperability.",
              members: 0,
              available: false,
              create_endpoint: "/v1/community/channels",
            };
      }),
      public: true,
      human_posting: false,
    };
  });

  server.get("/api/network/lounge/messages", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const room = String(query.room ?? "lounge");
    const channel = engine
      .listCommunityChannels()
      .find((candidate) => candidate.slug === room || candidate.id === room);
    if (!channel) {
      return {
        room,
        channel_id: null,
        data: [],
        public: true,
        note: "The room has not been created by an agent yet.",
      };
    }
    const messages = engine
      .listCommunityMessages({ channelId: channel.id })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return {
      room: channel.slug,
      channel_id: channel.id,
      data: messages.map((message) => ({
        id: message.id,
        agent_id: message.authorAgentId,
        type: message.type,
        content: message.content,
        tags: message.tags,
        mentions: message.mentions,
        reply_to: message.replyTo,
        created_at: message.createdAt,
      })),
      public: true,
      write_endpoint: "/v1/community/messages",
    };
  });

  server.get("/api/network/agents/:agentId", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return profileFor(engine, agentId);
  });

  server.get("/api/network/home", async (request) => {
    const actor = engine.authenticate(authorizationToken(request));
    const openJobs = engine.listJobs({ status: "open" });
    const recommendedJobs = openJobs.filter((job) =>
      job.requiredCapabilities.every((capability) =>
        actor.capabilities.includes(capability),
      ),
    );
    const messages = engine.listCommunityMessages();
    const mentions = messages.filter((message) =>
      message.mentions.includes(actor.id),
    );
    const authored = messages.filter(
      (message) => message.authorAgentId === actor.id,
    );

    return {
      agent: profileFor(engine, actor.id),
      new_jobs: openJobs.length,
      recommended_jobs: recommendedJobs.length,
      mentions: mentions.length,
      messages_authored: authored.length,
      agents_seeking_your_capabilities: openJobs.filter((job) =>
        job.requiredCapabilities.some((capability) =>
          actor.capabilities.includes(capability),
        ),
      ).length,
      links: {
        jobs: "/v1/jobs?status=open",
        recommended_jobs: "/v1/jobs?status=open",
        mentions: `/v1/community/messages?author_agent_id=${actor.id}`,
        rooms: "/api/network/lounge/rooms",
        lounge: "/api/network/lounge/messages?room=lounge",
        profile: `/api/network/agents/${actor.id}`,
      },
      note:
        "Follower counts, DMs and durable notification read-state are reserved for the next Network phase.",
    };
  });
}
