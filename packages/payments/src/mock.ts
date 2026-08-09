import {
  canonicalJson,
  nowIso,
  parseMinor,
  secureEqual,
  sha256,
  uuid,
  type JsonValue,
} from "@a2a402/shared";
import { createHmac } from "node:crypto";
import { encodeX402Header } from "./encoding.js";
import {
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentAdapterHealth,
  type PaymentRefund,
  type PaymentRequirement,
  type PaymentRequirementRequest,
  type PaymentSettlement,
  type PaymentTransaction,
  type PaymentVerification,
  type RefundPaymentInput,
  type SettlePaymentInput,
  type VerifyPaymentInput,
  type WalletBalance,
} from "./types.js";

export interface MockWalletSeed {
  address: string;
  asset: string;
  balanceMinor: string | bigint;
  signingSecret: string;
}

export interface MockPaymentAdapterOptions {
  wallets?: readonly MockWalletSeed[];
  network?: string;
  receiptSigningSecret?: string;
  now?: () => Date;
}

export interface MockPaymentPayload {
  version: "a2a402-mock-payment/0.1";
  paymentId: string;
  requirementId: string;
  payer: string;
  amountMinor: string;
  asset: string;
  nonce: string;
  signature: string;
}

interface MockWallet {
  balances: Map<string, bigint>;
  signingSecret: string;
}

interface IdempotentValue<T> {
  fingerprint: string;
  value: T;
}

function hmac(secret: string, value: unknown): string {
  return createHmac("sha256", secret)
    .update(canonicalJson(value))
    .digest("hex");
}

function unsignedMockPayload(
  payload: Omit<MockPaymentPayload, "signature">,
): Omit<MockPaymentPayload, "signature"> {
  return payload;
}

function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

function isMockPaymentPayload(value: unknown): value is MockPaymentPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === "a2a402-mock-payment/0.1" &&
    typeof payload.paymentId === "string" &&
    typeof payload.requirementId === "string" &&
    typeof payload.payer === "string" &&
    typeof payload.amountMinor === "string" &&
    typeof payload.asset === "string" &&
    typeof payload.nonce === "string" &&
    typeof payload.signature === "string"
  );
}

export class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = "mock" as const;
  readonly network: string;

  private readonly now: () => Date;
  private readonly receiptSigningSecret: string;
  private readonly wallets = new Map<string, MockWallet>();
  private readonly requirements = new Map<string, PaymentRequirement>();
  private readonly requirementByIdempotency = new Map<
    string,
    IdempotentValue<PaymentRequirement>
  >();
  private readonly paymentFingerprints = new Map<string, string>();
  private readonly verificationByPaymentId = new Map<
    string,
    PaymentVerification
  >();
  private readonly transactionByPaymentId = new Map<
    string,
    PaymentTransaction
  >();
  private readonly transactionByHash = new Map<string, PaymentTransaction>();
  private readonly settlementByPaymentId = new Map<string, PaymentSettlement>();
  private readonly settlementByIdempotency = new Map<
    string,
    IdempotentValue<PaymentSettlement>
  >();
  private readonly refundByIdempotency = new Map<
    string,
    IdempotentValue<PaymentRefund>
  >();
  private readonly settledPaymentByRequirement = new Map<string, string>();

  constructor(options: MockPaymentAdapterOptions = {}) {
    this.network = options.network ?? "mock";
    this.now = options.now ?? (() => new Date());
    this.receiptSigningSecret =
      options.receiptSigningSecret ?? "a2a402-local-mock-receipt-key";
    for (const seed of options.wallets ?? []) {
      this.seedWallet(seed);
    }
  }

  seedWallet(seed: MockWalletSeed): void {
    const amount = parseMinor(seed.balanceMinor, "balance_minor");
    const existing = this.wallets.get(seed.address);
    if (existing && existing.signingSecret !== seed.signingSecret) {
      throw new PaymentAdapterError(
        "PAYMENT_INVALID",
        "A mock wallet cannot be reseeded with a different signing secret.",
      );
    }
    const wallet = existing ?? {
      balances: new Map<string, bigint>(),
      signingSecret: seed.signingSecret,
    };
    wallet.balances.set(seed.asset, amount);
    this.wallets.set(seed.address, wallet);
  }

  creditWallet(
    address: string,
    asset: string,
    amountMinor: string | bigint,
  ): void {
    const wallet = this.wallets.get(address);
    if (!wallet) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "The mock wallet is not configured.",
      );
    }
    wallet.balances.set(
      asset,
      (wallet.balances.get(asset) ?? 0n) + parseMinor(amountMinor),
    );
  }

  static createPaymentPayload(
    requirement: PaymentRequirement,
    payer: string,
    signingSecret: string,
    options: { paymentId?: string; nonce?: string } = {},
  ): MockPaymentPayload {
    const unsigned = unsignedMockPayload({
      version: "a2a402-mock-payment/0.1",
      paymentId: options.paymentId ?? uuid(),
      requirementId: requirement.id,
      payer,
      amountMinor: requirement.amountMinor,
      asset: requirement.asset,
      nonce: options.nonce ?? uuid(),
    });
    return { ...unsigned, signature: hmac(signingSecret, unsigned) };
  }

  async createPaymentRequirement(
    request: PaymentRequirementRequest,
  ): Promise<PaymentRequirement> {
    const amount = parseMinor(request.amountMinor);
    if (amount <= 0n) {
      throw new PaymentAdapterError(
        "PAYMENT_INVALID",
        "Payment amount must be positive.",
      );
    }
    const requestFingerprint = fingerprint({
      ...request,
      amountMinor: amount.toString(),
    });
    const existing = this.requirementByIdempotency.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new PaymentAdapterError(
          "PAYMENT_IDEMPOTENCY_CONFLICT",
          "The payment requirement idempotency key was reused with different input.",
        );
      }
      return existing.value;
    }

    const createdAt = this.now().toISOString();
    const expiresAt =
      request.expiresAt ??
      new Date(this.now().getTime() + 15 * 60_000).toISOString();
    if (Date.parse(expiresAt) <= this.now().getTime()) {
      throw new PaymentAdapterError(
        "PAYMENT_EXPIRED",
        "Payment requirement expiration must be in the future.",
      );
    }
    const id = uuid();
    const offer = {
      version: "a2a402-mock-offer/0.1",
      requirementId: id,
      network: this.network,
      amountMinor: amount.toString(),
      asset: request.asset,
      payTo: request.payTo,
      resource: request.resource,
      expiresAt,
    };
    const body = {
      x402Version: 2,
      error: "Payment required",
      resource: request.resource,
      accepts: [
        {
          scheme: "exact",
          network: this.network,
          asset: request.asset,
          amount: amount.toString(),
          payTo: request.payTo,
          maxTimeoutSeconds: 900,
          extra: { simulation: true },
        },
      ],
      extensions: {
        "a2a402.offer": {
          ...offer,
          signature: hmac(this.receiptSigningSecret, offer),
        },
      },
    };
    const jsonBody = JSON.parse(JSON.stringify(body)) as Record<
      string,
      JsonValue
    >;
    const requirement: PaymentRequirement = {
      id,
      mode: this.mode,
      scheme: "exact",
      network: this.network,
      asset: request.asset,
      amountMinor: amount.toString(),
      payTo: request.payTo,
      resource: request.resource,
      createdAt,
      expiresAt,
      offerSignature: hmac(this.receiptSigningSecret, offer),
      http: {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encodeX402Header(body) },
        body: jsonBody,
      },
      protocolData: {
        simulation: true,
        metadata: request.metadata ?? {},
      },
    };
    this.requirements.set(id, requirement);
    this.requirementByIdempotency.set(request.idempotencyKey, {
      fingerprint: requestFingerprint,
      value: requirement,
    });
    return requirement;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerification> {
    if (!isMockPaymentPayload(input.payload)) {
      return this.invalidVerification(input, "Malformed mock payment payload.");
    }
    const payload = input.payload;
    const payloadFingerprint = fingerprint(payload);
    const seenFingerprint = this.paymentFingerprints.get(input.paymentId);
    if (seenFingerprint && seenFingerprint !== payloadFingerprint) {
      return this.invalidVerification(input, "PAYMENT_REPLAYED");
    }
    const cached = this.verificationByPaymentId.get(input.paymentId);
    if (cached) return cached;
    this.paymentFingerprints.set(input.paymentId, payloadFingerprint);

    const storedRequirement = this.requirements.get(input.requirement.id);
    if (
      !storedRequirement ||
      fingerprint(storedRequirement) !== fingerprint(input.requirement)
    ) {
      return this.invalidVerification(input, "PAYMENT_REQUIREMENT_MISMATCH");
    }
    if (
      payload.paymentId !== input.paymentId ||
      payload.requirementId !== input.requirement.id ||
      payload.amountMinor !== input.requirement.amountMinor ||
      payload.asset !== input.requirement.asset
    ) {
      return this.invalidVerification(input, "PAYMENT_REQUIREMENT_MISMATCH");
    }
    if (Date.parse(input.requirement.expiresAt) <= this.now().getTime()) {
      return this.invalidVerification(input, "PAYMENT_EXPIRED");
    }
    const wallet = this.wallets.get(payload.payer);
    if (!wallet)
      return this.invalidVerification(input, "Unknown mock payer wallet.");
    const unsigned = { ...payload };
    delete (unsigned as Partial<MockPaymentPayload>).signature;
    const expectedSignature = hmac(
      wallet.signingSecret,
      unsignedMockPayload(unsigned as Omit<MockPaymentPayload, "signature">),
    );
    if (!secureEqual(payload.signature, expectedSignature)) {
      return this.invalidVerification(input, "Invalid mock payment signature.");
    }
    if (
      (wallet.balances.get(payload.asset) ?? 0n) < BigInt(payload.amountMinor)
    ) {
      return this.invalidVerification(input, "PAYMENT_INSUFFICIENT_FUNDS");
    }
    const requirementPayment = this.settledPaymentByRequirement.get(
      input.requirement.id,
    );
    if (requirementPayment && requirementPayment !== input.paymentId) {
      return this.invalidVerification(input, "PAYMENT_ALREADY_SETTLED");
    }

    const verifiedAt = this.now().toISOString();
    const verification: PaymentVerification = {
      id: uuid(),
      paymentId: input.paymentId,
      requirementId: input.requirement.id,
      valid: true,
      payer: payload.payer,
      verifiedAt,
      protocolData: { simulation: true },
    };
    const transaction: PaymentTransaction = {
      id: uuid(),
      paymentId: input.paymentId,
      requirementId: input.requirement.id,
      network: this.network,
      asset: input.requirement.asset,
      amountMinor: input.requirement.amountMinor,
      refundedMinor: "0",
      payer: payload.payer,
      payee: input.requirement.payTo,
      status: "verified",
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
      protocolData: { simulation: true },
    };
    this.verificationByPaymentId.set(input.paymentId, verification);
    this.transactionByPaymentId.set(input.paymentId, transaction);
    return verification;
  }

  async settlePayment(input: SettlePaymentInput): Promise<PaymentSettlement> {
    const inputFingerprint = fingerprint({
      requirementId: input.requirement.id,
      verificationId: input.verification.id,
    });
    const existingIdempotency = this.settlementByIdempotency.get(
      input.idempotencyKey,
    );
    if (existingIdempotency) {
      if (existingIdempotency.fingerprint !== inputFingerprint) {
        throw new PaymentAdapterError(
          "PAYMENT_IDEMPOTENCY_CONFLICT",
          "The settlement idempotency key was reused with different input.",
        );
      }
      return existingIdempotency.value;
    }
    if (!input.verification.valid) {
      throw new PaymentAdapterError(
        "PAYMENT_NOT_VERIFIED",
        "An invalid payment cannot be settled.",
      );
    }
    const canonicalVerification = this.verificationByPaymentId.get(
      input.verification.paymentId,
    );
    if (
      !canonicalVerification ||
      canonicalVerification.id !== input.verification.id ||
      canonicalVerification.requirementId !== input.requirement.id
    ) {
      throw new PaymentAdapterError(
        "PAYMENT_NOT_VERIFIED",
        "The verification is not recognized by this adapter.",
      );
    }
    const existingSettlement = this.settlementByPaymentId.get(
      input.verification.paymentId,
    );
    if (existingSettlement) {
      this.settlementByIdempotency.set(input.idempotencyKey, {
        fingerprint: inputFingerprint,
        value: existingSettlement,
      });
      return existingSettlement;
    }
    const requirementPayment = this.settledPaymentByRequirement.get(
      input.requirement.id,
    );
    if (
      requirementPayment &&
      requirementPayment !== input.verification.paymentId
    ) {
      throw new PaymentAdapterError(
        "PAYMENT_ALREADY_SETTLED",
        "The exact-price requirement has already been settled.",
      );
    }

    const transaction = this.transactionByPaymentId.get(
      input.verification.paymentId,
    );
    if (!transaction) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "The verified mock transaction no longer exists.",
      );
    }
    const payer = this.wallets.get(transaction.payer);
    if (!payer) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "The payer wallet no longer exists.",
      );
    }
    const amount = BigInt(transaction.amountMinor);
    const payerBalance = payer.balances.get(transaction.asset) ?? 0n;
    if (payerBalance < amount) {
      throw new PaymentAdapterError(
        "PAYMENT_INSUFFICIENT_FUNDS",
        "The payer balance became insufficient before settlement.",
      );
    }
    let payee = this.wallets.get(transaction.payee);
    if (!payee) {
      payee = { balances: new Map(), signingSecret: uuid() };
      this.wallets.set(transaction.payee, payee);
    }
    payer.balances.set(transaction.asset, payerBalance - amount);
    payee.balances.set(
      transaction.asset,
      (payee.balances.get(transaction.asset) ?? 0n) + amount,
    );

    const settledAt = this.now().toISOString();
    const transactionHash = `mock:${sha256(
      canonicalJson({
        paymentId: input.verification.paymentId,
        requirementId: input.requirement.id,
        amountMinor: transaction.amountMinor,
        settledAt,
      }),
    )}`;
    const unsignedReceipt = {
      version: "a2a402-payment-receipt/0.1" as const,
      paymentId: input.verification.paymentId,
      requirementId: input.requirement.id,
      transactionHash,
      network: this.network,
      asset: transaction.asset,
      amountMinor: transaction.amountMinor,
      payer: transaction.payer,
      payee: transaction.payee,
      settledAt,
      protocolData: { simulation: true },
    };
    const settlement: PaymentSettlement = {
      id: uuid(),
      paymentId: input.verification.paymentId,
      transactionHash,
      status: "settled",
      receipt: {
        ...unsignedReceipt,
        signature: hmac(this.receiptSigningSecret, unsignedReceipt),
      },
    };
    transaction.transactionHash = transactionHash;
    transaction.status = "settled";
    transaction.updatedAt = settledAt;
    this.transactionByHash.set(transactionHash, transaction);
    this.settlementByPaymentId.set(input.verification.paymentId, settlement);
    this.settledPaymentByRequirement.set(
      input.requirement.id,
      input.verification.paymentId,
    );
    this.settlementByIdempotency.set(input.idempotencyKey, {
      fingerprint: inputFingerprint,
      value: settlement,
    });
    return settlement;
  }

  async refundPayment(input: RefundPaymentInput): Promise<PaymentRefund> {
    const transaction = this.transactionByHash.get(input.transactionHash);
    if (!transaction) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "The mock settlement transaction was not found.",
      );
    }
    const requestedAmount =
      input.amountMinor === undefined
        ? BigInt(transaction.amountMinor) - BigInt(transaction.refundedMinor)
        : parseMinor(input.amountMinor, "refund_amount_minor");
    const inputFingerprint = fingerprint({
      transactionHash: input.transactionHash,
      amountMinor: requestedAmount.toString(),
      reason: input.reason ?? null,
    });
    const existing = this.refundByIdempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new PaymentAdapterError(
          "PAYMENT_IDEMPOTENCY_CONFLICT",
          "The refund idempotency key was reused with different input.",
        );
      }
      return existing.value;
    }
    const remaining =
      BigInt(transaction.amountMinor) - BigInt(transaction.refundedMinor);
    if (requestedAmount <= 0n || requestedAmount > remaining) {
      throw new PaymentAdapterError(
        "PAYMENT_REFUND_EXCEEDS_SETTLEMENT",
        "Refund amount exceeds the unrefunded settlement amount.",
      );
    }
    const payer = this.wallets.get(transaction.payer);
    const payee = this.wallets.get(transaction.payee);
    if (!payer || !payee) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "A wallet required for the refund is unavailable.",
      );
    }
    const payeeBalance = payee.balances.get(transaction.asset) ?? 0n;
    if (payeeBalance < requestedAmount) {
      throw new PaymentAdapterError(
        "PAYMENT_INSUFFICIENT_FUNDS",
        "The payee has insufficient simulated funds for the refund.",
      );
    }
    payee.balances.set(transaction.asset, payeeBalance - requestedAmount);
    payer.balances.set(
      transaction.asset,
      (payer.balances.get(transaction.asset) ?? 0n) + requestedAmount,
    );

    const refundedAt = this.now().toISOString();
    const refundedTotal = BigInt(transaction.refundedMinor) + requestedAmount;
    const status =
      refundedTotal === BigInt(transaction.amountMinor)
        ? ("refunded" as const)
        : ("partially_refunded" as const);
    transaction.refundedMinor = refundedTotal.toString();
    transaction.status = status;
    transaction.updatedAt = refundedAt;
    const refund: PaymentRefund = {
      id: uuid(),
      transactionHash: input.transactionHash,
      refundTransactionHash: `mock-refund:${sha256(
        canonicalJson({
          transactionHash: input.transactionHash,
          amountMinor: requestedAmount.toString(),
          refundedAt,
        }),
      )}`,
      amountMinor: requestedAmount.toString(),
      status,
      refundedAt,
    };
    this.refundByIdempotency.set(input.idempotencyKey, {
      fingerprint: inputFingerprint,
      value: refund,
    });
    return refund;
  }

  async getTransaction(
    transactionHash: string,
  ): Promise<PaymentTransaction | null> {
    return this.transactionByHash.get(transactionHash) ?? null;
  }

  async getWalletBalance(
    address: string,
    asset: string,
  ): Promise<WalletBalance> {
    const wallet = this.wallets.get(address);
    return {
      address,
      network: this.network,
      asset,
      balanceMinor: (wallet?.balances.get(asset) ?? 0n).toString(),
      observedAt: this.now().toISOString(),
    };
  }

  async health(): Promise<PaymentAdapterHealth> {
    return {
      mode: this.mode,
      healthy: true,
      network: this.network,
      details: {
        simulation: true,
        requirements: this.requirements.size,
        settled_payments: this.settlementByPaymentId.size,
      },
    };
  }

  private invalidVerification(
    input: VerifyPaymentInput,
    reason: string,
  ): PaymentVerification {
    const verification: PaymentVerification = {
      id: uuid(),
      paymentId: input.paymentId,
      requirementId: input.requirement.id,
      valid: false,
      verifiedAt: this.now().toISOString(),
      reason,
    };
    this.verificationByPaymentId.set(input.paymentId, verification);
    return verification;
  }
}
