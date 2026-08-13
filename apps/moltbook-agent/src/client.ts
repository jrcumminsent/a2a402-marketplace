const MOLTBOOK_ORIGIN = "https://www.moltbook.com";
const API_BASE = `${MOLTBOOK_ORIGIN}/api/v1`;

export class MoltbookApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "MoltbookApiError";
  }
}

export interface MoltbookRegistration {
  apiKey: string;
  claimUrl: string;
  verificationCode: string | null;
}

export interface MoltbookItem {
  id: string;
  postId: string;
  type: "post" | "comment";
  title: string | null;
  content: string;
  authorName: string;
  similarity: number;
}

type Fetcher = typeof fetch;

export class MoltbookClient {
  constructor(
    private readonly apiKey: string | null,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const url = new URL(`${API_BASE}${path}`);
    if (
      url.origin !== MOLTBOOK_ORIGIN ||
      !url.pathname.startsWith("/api/v1/")
    ) {
      throw new Error("Refusing to send Moltbook credentials off origin.");
    }
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);
    const response = await this.fetcher(url, { ...init, headers });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      throw new MoltbookApiError(
        typeof body.message === "string"
          ? body.message
          : `Moltbook returned HTTP ${response.status}.`,
        response.status,
        retry && /^\d+$/.test(retry) ? Number(retry) : null,
      );
    }
    return body;
  }

  async register(
    name: string,
    description: string,
  ): Promise<MoltbookRegistration> {
    const body = (await this.request("/agents/register", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    })) as { agent?: Record<string, unknown> };
    const agent = body.agent;
    if (
      !agent ||
      typeof agent.api_key !== "string" ||
      typeof agent.claim_url !== "string" ||
      new URL(agent.claim_url).origin !== MOLTBOOK_ORIGIN
    ) {
      throw new Error(
        "Moltbook registration response is incomplete or unsafe.",
      );
    }
    return {
      apiKey: agent.api_key,
      claimUrl: agent.claim_url,
      verificationCode:
        typeof agent.verification_code === "string"
          ? agent.verification_code
          : null,
    };
  }

  async status(): Promise<string> {
    const body = (await this.request("/agents/status")) as { status?: unknown };
    if (typeof body.status !== "string")
      throw new Error("Invalid claim status.");
    return body.status;
  }

  async search(query: string, limit = 10): Promise<MoltbookItem[]> {
    const body = (await this.request(
      `/search?q=${encodeURIComponent(query)}&type=posts&limit=${limit}`,
    )) as { results?: unknown };
    if (!Array.isArray(body.results)) return [];
    return body.results.flatMap((value): MoltbookItem[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const author = item.author as Record<string, unknown> | undefined;
      if (
        typeof item.id !== "string" ||
        typeof item.content !== "string" ||
        typeof author?.name !== "string"
      )
        return [];
      return [
        {
          id: item.id,
          postId: typeof item.post_id === "string" ? item.post_id : item.id,
          type: item.type === "comment" ? "comment" : "post",
          title: typeof item.title === "string" ? item.title : null,
          content: item.content,
          authorName: author.name,
          similarity: typeof item.similarity === "number" ? item.similarity : 0,
        },
      ];
    });
  }

  comment(postId: string, content: string): Promise<unknown> {
    return this.request(`/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  createPost(
    submolt: string,
    title: string,
    content: string,
  ): Promise<unknown> {
    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify({ submolt_name: submolt, title, content }),
    });
  }
}
