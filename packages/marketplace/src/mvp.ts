import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  canonicalJson,
  MarketplaceError,
  nowIso,
  parseMinor,
  sha256,
  type JsonValue,
} from "@a2a402/shared";

/**
 * Isolated, deliberately small compatibility implementation for the
 * a2a402-poe/0.1 demonstration. It has no dependency on the main marketplace
 * engine, payment adapters, or web framework.
 */
export const MVP_CURRENCY = "A2A_TEST" as const;
export const MVP_PROOF_VERSION = "a2a402-poe/0.1" as const;

export interface MvpAgent {
  agent_id: string;
  public_key: string;
  display_name: string;
  endpoint: string | null;
  capabilities: string[];
  status: "ACTIVE" | "SUSPENDED";
  created_at: string;
  updated_at: string;
}

export interface MvpSignedRequest {
  agent_id: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export interface MvpJob {
  job_id: string;
  creator_agent_id: string | null;
  title: string;
  description: string;
  reward: bigint;
  currency: typeof MVP_CURRENCY;
  status: "OPEN" | "ACCEPTED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "FAILED";
  expected_result: JsonValue;
  accepting_agent_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface MvpProofOfEarn {
  proof_id: string;
  version: typeof MVP_PROOF_VERSION;
  agent_id: string;
  job_id: string;
  settlement_id: string;
  amount: string;
  currency: typeof MVP_CURRENCY;
  classification: "EARNED";
  payer: { type: "platform" | "agent"; id: string };
  reason: "JOB_COMPLETION";
  earned_at: string;
  provenance_references: string[];
  marketplace: "a2a402.market";
  signature_algorithm: "Ed25519";
  key_id: string;
  signature: string;
}

interface Lot {
  proofId: string;
  available: bigint;
  reserved: bigint;
}

interface Reservation {
  agentId: string;
  allocations: Array<{ proofId: string; amount: bigint }>;
}

interface MvpSettlement {
  settlement_id: string;
  job_id: string;
  payer: { type: "platform" | "agent"; id: string };
  payee_agent_id: string;
  amount: bigint;
  proof_id: string;
  settled_at: string;
}

export interface MvpBalance {
  currency: typeof MVP_CURRENCY;
  earned_available: string;
  earned_reserved: string;
  seeded_available: "0";
}

export interface MvpMarketplaceOptions {
  signingPrivateKey?: KeyObject;
  signingPublicKey?: KeyObject;
  keyId?: string;
  now?: () => string;
  nonceTtlMs?: number;
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function publicKeyFromBase64(value: string): KeyObject {
  try {
    const key = createPublicKey({
      key: Buffer.from(value, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    return key;
  } catch {
    throw new MarketplaceError("VALIDATION_ERROR", "public_key must be a base64 Ed25519 SPKI key.");
  }
}

export function mvpSigningPayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: JsonValue,
): string {
  return canonicalJson({ method: method.toUpperCase(), path, timestamp, nonce, body_hash: sha256(canonicalJson(body)) });
}

export function mvpProofPayload(proof: Omit<MvpProofOfEarn, "signature">): string {
  return canonicalJson(proof);
}

export class MvpMarketplace {
  readonly keyId: string;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly now: () => string;
  private readonly nonceTtlMs: number;
  private readonly agents = new Map<string, MvpAgent>();
  private readonly jobs = new Map<string, MvpJob>();
  private readonly lots = new Map<string, Lot[]>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly submissions = new Map<string, { agentId: string; payload: JsonValue }>();
  private readonly settlements = new Map<string, MvpSettlement>();
  private readonly proofs = new Map<string, MvpProofOfEarn>();
  private readonly nonces = new Set<string>();
  private readonly idempotency = new Map<string, { hash: string; value: unknown }>();
  private readonly ledger: Array<{ transaction_id: string; account: string; side: "DEBIT" | "CREDIT"; amount: bigint; created_at: string }> = [];
  private treasury = 2_500n;

  constructor(options: MvpMarketplaceOptions = {}) {
    const keys = options.signingPrivateKey && options.signingPublicKey
      ? { privateKey: options.signingPrivateKey, publicKey: options.signingPublicKey }
      : generateKeyPairSync("ed25519");
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    this.keyId = options.keyId ?? "a2a402-mvp-dev-1";
    this.now = options.now ?? nowIso;
    this.nonceTtlMs = options.nonceTtlMs ?? 300_000;
    this.createGenesisBounty();
    this.createStarterJobs();
  }

  marketplacePublicKey(): string {
    return this.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }

  createGenesisBounty(): MvpJob {
    const existing = this.jobs.get("job_genesis_bounty");
    if (existing) return existing;
    const created = this.now();
    const job: MvpJob = {
      job_id: "job_genesis_bounty",
      creator_agent_id: null,
      title: "Genesis deterministic JSON transformation",
      description: "Return the canonical deterministic transformation result.",
      reward: 1_000n,
      currency: MVP_CURRENCY,
      status: "OPEN",
      expected_result: { normalized: "GENESIS_OK", value: 42 },
      accepting_agent_id: null,
      created_at: created,
      expires_at: new Date(Date.parse(created) + 86_400_000).toISOString(),
    };
    this.jobs.set(job.job_id, job);
    return job;
  }

  private createStarterJobs(): void {
    const created = this.now();
    const expiresAt = new Date(Date.parse(created) + 86_400_000).toISOString();
    const starterJobs: MvpJob[] = [
      {
        job_id: "job_starter_uppercase",
        creator_agent_id: null,
        title: "Starter: uppercase a short phrase",
        description: "Return one JSON object containing the uppercase version of the supplied phrase: hello agents.",
        reward: 100n,
        currency: MVP_CURRENCY,
        status: "OPEN",
        expected_result: { text: "HELLO AGENTS" },
        accepting_agent_id: null,
        created_at: created,
        expires_at: expiresAt,
      },
      {
        job_id: "job_starter_classify_test_asset",
        creator_agent_id: null,
        title: "Starter: classify the test asset",
        description: "Classify the statement 'A2A_TEST has no real-world monetary value' using the requested JSON label.",
        reward: 100n,
        currency: MVP_CURRENCY,
        status: "OPEN",
        expected_result: { classification: "TEST_ONLY" },
        accepting_agent_id: null,
        created_at: created,
        expires_at: expiresAt,
      },
      {
        job_id: "job_starter_sum_42",
        creator_agent_id: null,
        title: "Starter: sum three integers",
        description: "Add 7, 11, and 24 and return the deterministic JSON result.",
        reward: 150n,
        currency: MVP_CURRENCY,
        status: "OPEN",
        expected_result: { sum: 42 },
        accepting_agent_id: null,
        created_at: created,
        expires_at: expiresAt,
      },
      {
        job_id: "job_starter_extract_fields",
        creator_agent_id: null,
        title: "Starter: extract two JSON fields",
        description: "From {agent:'worker', task:'extract', ignore:'x'}, return only agent and task as JSON.",
        reward: 200n,
        currency: MVP_CURRENCY,
        status: "OPEN",
        expected_result: { agent: "worker", task: "extract" },
        accepting_agent_id: null,
        created_at: created,
        expires_at: expiresAt,
      },
    ];
    for (const job of starterJobs) {
      if (!this.jobs.has(job.job_id)) this.jobs.set(job.job_id, job);
    }
  }

  registerAgent(input: Omit<MvpAgent, "agent_id" | "status" | "created_at" | "updated_at"> & { registration_signature: string }): MvpAgent {
    if (!input.display_name.trim() || input.display_name.length > 120 || input.capabilities.length > 32) {
      throw new MarketplaceError("VALIDATION_ERROR", "display_name and capabilities exceed MVP limits.");
    }
    const body = {
      public_key: input.public_key,
      display_name: input.display_name,
      endpoint: input.endpoint,
      capabilities: [...input.capabilities].sort(),
    } as JsonValue;
    const key = publicKeyFromBase64(input.public_key);
    if (!verify(null, Buffer.from(canonicalJson(body)), key, Buffer.from(input.registration_signature, "base64"))) {
      throw new MarketplaceError("SIGNATURE_INVALID", "Registration signature is invalid.", 401);
    }
    const timestamp = this.now();
    const agent: MvpAgent = {
      agent_id: id("a2a"), public_key: input.public_key, display_name: input.display_name,
      endpoint: input.endpoint, capabilities: [...new Set(input.capabilities)].sort(), status: "ACTIVE",
      created_at: timestamp, updated_at: timestamp,
    };
    this.agents.set(agent.agent_id, agent);
    this.lots.set(agent.agent_id, []);
    return agent;
  }

  listJobs(): MvpJob[] { return [...this.jobs.values()].map((job) => ({ ...job })); }
  getAgent(agentId: string): MvpAgent { return { ...this.requireAgent(agentId) }; }
  getJob(jobId: string): MvpJob { const job = this.jobs.get(jobId); if (!job) throw new MarketplaceError("RESOURCE_NOT_FOUND", "Job was not found.", 404); return { ...job }; }
  getProof(proofId: string): MvpProofOfEarn { const proof = this.proofs.get(proofId); if (!proof) throw new MarketplaceError("RESOURCE_NOT_FOUND", "Proof was not found.", 404); return { ...proof, payer: { ...proof.payer }, provenance_references: [...proof.provenance_references] }; }

  createJob(agentId: string, auth: MvpSignedRequest, input: { title: string; description: string; reward: string | bigint; expected_result: JsonValue; expires_at?: string }, idempotencyKey: string): MvpJob {
    const body = { ...input, reward: typeof input.reward === "bigint" ? input.reward.toString() : input.reward } as JsonValue;
    return this.idempotent(agentId, idempotencyKey, body, () => {
      this.authenticate(agentId, auth, "POST", "/api/v1/jobs", body);
      const reward = parseMinor(input.reward, "reward");
      if (reward === 0n || !input.title.trim() || !input.description.trim()) throw new MarketplaceError("VALIDATION_ERROR", "Job title, description, and positive reward are required.");
      const allocations = this.reserve(agentId, reward);
      const created = this.now();
      const job: MvpJob = { job_id: id("job"), creator_agent_id: agentId, title: input.title, description: input.description, reward, currency: MVP_CURRENCY, status: "OPEN", expected_result: input.expected_result, accepting_agent_id: null, created_at: created, expires_at: input.expires_at ?? new Date(Date.parse(created) + 86_400_000).toISOString() };
      this.jobs.set(job.job_id, job);
      this.reservations.set(job.job_id, { agentId, allocations });
      this.post("reservation", `agent:${agentId}:earned_available`, `agent:${agentId}:earned_reserved`, reward);
      return job;
    });
  }

  acceptJob(agentId: string, jobId: string, auth: MvpSignedRequest, idempotencyKey: string): MvpJob {
    const body = { job_id: jobId } as JsonValue;
    return this.idempotent(agentId, idempotencyKey, body, () => {
      this.authenticate(agentId, auth, "POST", `/api/v1/jobs/${jobId}/accept`, body);
      const job = this.getMutableJob(jobId);
      if (job.status !== "OPEN" || Date.parse(job.expires_at) <= Date.parse(this.now())) throw new MarketplaceError("INVALID_STATE_TRANSITION", "Job is not available for acceptance.", 409);
      job.status = "ACCEPTED"; job.accepting_agent_id = agentId;
      return { ...job };
    });
  }

  submitJob(agentId: string, jobId: string, auth: MvpSignedRequest, payload: JsonValue, idempotencyKey: string): MvpSettlement {
    const body = { job_id: jobId, payload } as JsonValue;
    return this.idempotent(agentId, idempotencyKey, body, () => {
      this.authenticate(agentId, auth, "POST", `/api/v1/jobs/${jobId}/submit`, body);
      const job = this.getMutableJob(jobId);
      if (job.accepting_agent_id !== agentId) throw new MarketplaceError("FORBIDDEN", "Only the accepting agent may submit work.", 403);
      if (job.status !== "ACCEPTED") throw new MarketplaceError("INVALID_STATE_TRANSITION", "Job is not awaiting a submission.", 409);
      if (canonicalJson(payload) !== canonicalJson(job.expected_result)) { job.status = "FAILED"; throw new MarketplaceError("SCHEMA_VALIDATION_FAILED", "Submission does not satisfy the deterministic validation rule."); }
      job.status = "SUBMITTED";
      this.submissions.set(jobId, { agentId, payload });
      job.status = "COMPLETED";
      return this.settle(jobId);
    });
  }

  settle(jobId: string): MvpSettlement {
    const existing = this.settlements.get(jobId); if (existing) return { ...existing, payer: { ...existing.payer } };
    const job = this.getMutableJob(jobId);
    if (job.status !== "COMPLETED" || !job.accepting_agent_id) throw new MarketplaceError("INVALID_STATE_TRANSITION", "Only completed jobs can settle.", 409);
    const payer = job.creator_agent_id ? { type: "agent" as const, id: job.creator_agent_id } : { type: "platform" as const, id: "a2a402.market" };
    const provenance = job.creator_agent_id ? this.releaseReservation(job.job_id) : [];
    if (!job.creator_agent_id) { if (this.treasury < job.reward) throw new MarketplaceError("INSUFFICIENT_ELIGIBLE_CAPITAL", "Platform TEST treasury is exhausted.", 409); this.treasury -= job.reward; }
    const settlementId = id("set"); const earnedAt = this.now(); const proofId = id("poe");
    const unsigned: Omit<MvpProofOfEarn, "signature"> = { proof_id: proofId, version: MVP_PROOF_VERSION, agent_id: job.accepting_agent_id, job_id: job.job_id, settlement_id: settlementId, amount: job.reward.toString(), currency: MVP_CURRENCY, classification: "EARNED", payer, reason: "JOB_COMPLETION", earned_at: earnedAt, provenance_references: provenance, marketplace: "a2a402.market", signature_algorithm: "Ed25519", key_id: this.keyId };
    const proof: MvpProofOfEarn = { ...unsigned, signature: sign(null, Buffer.from(mvpProofPayload(unsigned)), this.privateKey).toString("base64") };
    this.proofs.set(proofId, proof); this.lots.get(job.accepting_agent_id)!.push({ proofId, available: job.reward, reserved: 0n });
    this.post(`settlement:${settlementId}`, job.creator_agent_id ? `agent:${job.creator_agent_id}:earned_reserved` : "platform:genesis_treasury", `agent:${job.accepting_agent_id}:earned_available`, job.reward);
    const settlement: MvpSettlement = { settlement_id: settlementId, job_id: job.job_id, payer, payee_agent_id: job.accepting_agent_id, amount: job.reward, proof_id: proofId, settled_at: earnedAt };
    this.settlements.set(jobId, settlement); return { ...settlement, payer: { ...payer } };
  }

  getBalance(agentId: string): MvpBalance {
    const lots = this.lots.get(agentId); if (!lots) this.requireAgent(agentId);
    return { currency: MVP_CURRENCY, earned_available: (lots ?? []).reduce((total, lot) => total + lot.available, 0n).toString(), earned_reserved: (lots ?? []).reduce((total, lot) => total + lot.reserved, 0n).toString(), seeded_available: "0" };
  }

  verifyProof(proof: MvpProofOfEarn): { valid: boolean; issuer: "a2a402.market"; classification: "EARNED" } {
    const { signature, ...unsigned } = proof;
    return { valid: proof.signature_algorithm === "Ed25519" && proof.key_id === this.keyId && verify(null, Buffer.from(mvpProofPayload(unsigned)), this.publicKey, Buffer.from(signature, "base64")), issuer: "a2a402.market", classification: "EARNED" };
  }

  provenance(proofId: string): string[] { const proof = this.getProof(proofId); return [...proof.provenance_references, proof.proof_id]; }
  ledgerEntries(): ReadonlyArray<{ transaction_id: string; account: string; side: "DEBIT" | "CREDIT"; amount: string; created_at: string }> { return this.ledger.map((entry) => ({ ...entry, amount: entry.amount.toString() })); }

  private authenticate(agentId: string, auth: MvpSignedRequest, method: string, path: string, body: JsonValue): void {
    const agent = this.requireAgent(agentId); if (agent.status !== "ACTIVE") throw new MarketplaceError("FORBIDDEN", "Suspended agents cannot perform state changes.", 403);
    if (auth.agent_id !== agentId) throw new MarketplaceError("AUTH_INVALID", "Signed request agent does not match the actor.", 401);
    const timestamp = Date.parse(auth.timestamp); if (!Number.isFinite(timestamp) || Math.abs(Date.parse(this.now()) - timestamp) > this.nonceTtlMs) throw new MarketplaceError("AUTH_NONCE_EXPIRED", "Signed request timestamp has expired.", 401);
    const nonceKey = `${agentId}:${auth.nonce}`; if (this.nonces.has(nonceKey)) throw new MarketplaceError("AUTH_NONCE_REPLAYED", "Signed request nonce has already been used.", 409);
    const valid = verify(null, Buffer.from(mvpSigningPayload(method, path, auth.timestamp, auth.nonce, body)), publicKeyFromBase64(agent.public_key), Buffer.from(auth.signature, "base64"));
    if (!valid) throw new MarketplaceError("SIGNATURE_INVALID", "Signed request signature is invalid.", 401);
    this.nonces.add(nonceKey);
  }

  private reserve(agentId: string, amount: bigint): Array<{ proofId: string; amount: bigint }> {
    let remaining = amount; const allocations: Array<{ proofId: string; amount: bigint }> = [];
    for (const lot of this.lots.get(agentId) ?? []) { if (!remaining) break; const take = lot.available < remaining ? lot.available : remaining; if (take) { lot.available -= take; lot.reserved += take; allocations.push({ proofId: lot.proofId, amount: take }); remaining -= take; } }
    if (remaining) { for (const allocation of allocations) { const lot = this.lots.get(agentId)!.find((candidate) => candidate.proofId === allocation.proofId)!; lot.available += allocation.amount; lot.reserved -= allocation.amount; } throw new MarketplaceError("INSUFFICIENT_ELIGIBLE_CAPITAL", "Only earned A2A_TEST capital may fund agent jobs.", 402, { required_minor: amount.toString() }); }
    return allocations;
  }

  private releaseReservation(jobId: string): string[] {
    const reservation = this.reservations.get(jobId); if (!reservation) throw new MarketplaceError("INTERNAL_ERROR", "Missing earned-capital reservation.", 500);
    for (const allocation of reservation.allocations) { const lot = this.lots.get(reservation.agentId)!.find((candidate) => candidate.proofId === allocation.proofId)!; lot.reserved -= allocation.amount; }
    this.reservations.delete(jobId); return reservation.allocations.map((allocation) => allocation.proofId);
  }

  private idempotent<T>(agentId: string, key: string, body: JsonValue, operation: () => T): T {
    if (key.length < 8 || key.length > 200) throw new MarketplaceError("IDEMPOTENCY_KEY_REQUIRED", "x-idempotency-key must be 8-200 characters.");
    const recordKey = `${agentId}:${key}`; const hash = sha256(canonicalJson(body)); const existing = this.idempotency.get(recordKey);
    if (existing) { if (existing.hash !== hash) throw new MarketplaceError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused for a different request.", 409); return existing.value as T; }
    const value = operation(); this.idempotency.set(recordKey, { hash, value }); return value;
  }

  private post(transactionId: string, debitAccount: string, creditAccount: string, amount: bigint): void { const created_at = this.now(); this.ledger.push({ transaction_id: transactionId, account: debitAccount, side: "DEBIT", amount, created_at }, { transaction_id: transactionId, account: creditAccount, side: "CREDIT", amount, created_at }); }
  private requireAgent(agentId: string): MvpAgent { const agent = this.agents.get(agentId); if (!agent) throw new MarketplaceError("RESOURCE_NOT_FOUND", "Agent was not found.", 404); return agent; }
  private getMutableJob(jobId: string): MvpJob { const job = this.jobs.get(jobId); if (!job) throw new MarketplaceError("RESOURCE_NOT_FOUND", "Job was not found.", 404); return job; }
}
