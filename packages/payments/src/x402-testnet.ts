import {
  canonicalJson,
  nowIso,
  parseMinor,
  sha256,
  uuid,
  type JsonValue,
} from "@a2a402/shared";
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
} from "@x402/core/server";
import { encodeX402Header } from "./encoding.js";
import {
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentAdapterHealth,
  type PaymentReceipt,
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

export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;
export const BASE_SEPOLIA_USDC =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const DEFAULT_X402_TESTNET_FACILITATOR =
  "https://x402.org/facilitator" as const;

type OfficialPaymentPayload = Parameters<FacilitatorClient["verify"]>[0];
type OfficialPaymentRequirements = Parameters<FacilitatorClient["verify"]>[1];
type OfficialVerifyResponse = Awaited<ReturnType<FacilitatorClient["verify"]>>;
type OfficialSettleResponse = Awaited<ReturnType<FacilitatorClient["settle"]>>;

export interface X402FacilitatorPort {
  verify(
    payload: OfficialPaymentPayload,
    requirements: OfficialPaymentRequirements,
  ): Promise<OfficialVerifyResponse>;
  settle(
    payload: OfficialPaymentPayload,
    requirements: OfficialPaymentRequirements,
  ): Promise<OfficialSettleResponse>;
  getSupported(): Promise<unknown>;
}

export interface X402ObservedTransaction {
  transactionHash: string;
  network: string;
  asset: string;
  amountMinor: string;
  payer: string;
  payee: string;
  confirmed: boolean;
  protocolData?: Record<string, JsonValue>;
}

export interface X402ChainReader {
  getTransaction(
    transactionHash: string,
  ): Promise<X402ObservedTransaction | null>;
  getWalletBalance(
    address: string,
    asset: string,
    network: string,
  ): Promise<string>;
}

export interface X402RefundHandler {
  refund(input: {
    transaction: PaymentTransaction;
    amountMinor: string;
    idempotencyKey: string;
    reason?: string;
  }): Promise<{ transactionHash: string }>;
}

export interface X402TestnetPaymentAdapterOptions {
  platformSettlementAddress: string;
  facilitatorUrl?: string;
  facilitator?: X402FacilitatorPort;
  network?: typeof BASE_SEPOLIA_NETWORK;
  assetAddress?: string;
  assetSymbol?: string;
  enableMainnet?: boolean;
  chainReader?: X402ChainReader;
  refundHandler?: X402RefundHandler;
  signOffer?: (payload: unknown) => Promise<string>;
  signReceipt?: (payload: unknown) => Promise<string>;
  now?: () => Date;
}

interface IdempotentValue<T> {
  fingerprint: string;
  value: T;
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    ),
  ) as JsonValue;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getProtocolRequirement(
  requirement: PaymentRequirement,
): OfficialPaymentRequirements {
  const value = requirement.protocolData.paymentRequirements;
  if (!isObject(value)) {
    throw new PaymentAdapterError(
      "PAYMENT_REQUIREMENT_MISMATCH",
      "The x402 payment requirement is missing protocol payment requirements.",
    );
  }
  return value as OfficialPaymentRequirements;
}

function getOfficialPayload(value: unknown): OfficialPaymentPayload {
  if (
    !isObject(value) ||
    value.x402Version !== 2 ||
    !isObject(value.accepted) ||
    !isObject(value.payload)
  ) {
    throw new PaymentAdapterError(
      "PAYMENT_INVALID",
      "The x402 v2 payment payload is malformed.",
    );
  }
  return value as OfficialPaymentPayload;
}

function matchesRequirement(
  payload: OfficialPaymentPayload,
  requirements: OfficialPaymentRequirements,
): boolean {
  const accepted = payload.accepted;
  return (
    accepted.scheme === requirements.scheme &&
    accepted.network === requirements.network &&
    accepted.asset.toLowerCase() === requirements.asset.toLowerCase() &&
    accepted.amount === requirements.amount &&
    accepted.payTo.toLowerCase() === requirements.payTo.toLowerCase()
  );
}

export class X402TestnetPaymentAdapter implements PaymentAdapter {
  readonly mode = "x402_testnet" as const;
  readonly network = BASE_SEPOLIA_NETWORK;

  private readonly facilitator: X402FacilitatorPort;
  private readonly facilitatorUrl: string;
  private readonly assetAddress: string;
  private readonly assetSymbol: string;
  private readonly platformSettlementAddress: string;
  private readonly chainReader: X402ChainReader | undefined;
  private readonly refundHandler: X402RefundHandler | undefined;
  private readonly signOffer:
    ((payload: unknown) => Promise<string>) | undefined;
  private readonly signReceipt:
    ((payload: unknown) => Promise<string>) | undefined;
  private readonly now: () => Date;
  private readonly requirementByIdempotency = new Map<
    string,
    IdempotentValue<PaymentRequirement>
  >();
  private readonly paymentFingerprints = new Map<string, string>();
  private readonly verificationByPaymentId = new Map<
    string,
    PaymentVerification
  >();
  private readonly officialPayloadByPaymentId = new Map<
    string,
    OfficialPaymentPayload
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
  private readonly settlementInFlight = new Map<
    string,
    Promise<PaymentSettlement>
  >();
  private readonly verificationInFlight = new Map<
    string,
    Promise<PaymentVerification>
  >();

  constructor(options: X402TestnetPaymentAdapterOptions) {
    if (options.enableMainnet) {
      throw new PaymentAdapterError(
        "PAYMENT_UNSUPPORTED_NETWORK",
        "Mainnet is intentionally disabled in the a2a402 MVP.",
      );
    }
    if (options.network && options.network !== BASE_SEPOLIA_NETWORK) {
      throw new PaymentAdapterError(
        "PAYMENT_UNSUPPORTED_NETWORK",
        "The MVP x402 adapter only supports Base Sepolia.",
      );
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(options.platformSettlementAddress)) {
      throw new PaymentAdapterError(
        "PAYMENT_INVALID",
        "PLATFORM_SETTLEMENT_ADDRESS must be an EVM address.",
      );
    }
    this.facilitatorUrl =
      options.facilitatorUrl ?? DEFAULT_X402_TESTNET_FACILITATOR;
    this.facilitator =
      options.facilitator ??
      new HTTPFacilitatorClient({ url: this.facilitatorUrl });
    this.assetAddress = options.assetAddress ?? BASE_SEPOLIA_USDC;
    this.assetSymbol = options.assetSymbol ?? "USDC";
    this.platformSettlementAddress = options.platformSettlementAddress;
    this.chainReader = options.chainReader;
    this.refundHandler = options.refundHandler;
    this.signOffer = options.signOffer;
    this.signReceipt = options.signReceipt;
    this.now = options.now ?? (() => new Date());
  }

  async createPaymentRequirement(
    request: PaymentRequirementRequest,
  ): Promise<PaymentRequirement> {
    if (request.asset !== this.assetSymbol) {
      throw new PaymentAdapterError(
        "PAYMENT_UNSUPPORTED_ASSET",
        `The x402 testnet adapter accepts only ${this.assetSymbol}.`,
      );
    }
    if (
      request.payTo.toLowerCase() !==
      this.platformSettlementAddress.toLowerCase()
    ) {
      throw new PaymentAdapterError(
        "PAYMENT_REQUIREMENT_MISMATCH",
        "x402 payments must settle to the configured platform testnet account.",
      );
    }
    const amount = parseMinor(request.amountMinor);
    if (amount <= 0n) {
      throw new PaymentAdapterError(
        "PAYMENT_INVALID",
        "Payment amount must be positive.",
      );
    }
    const inputFingerprint = sha256(
      canonicalJson({ ...request, amountMinor: amount.toString() }),
    );
    const existing = this.requirementByIdempotency.get(request.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
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
    const timeoutSeconds = Math.max(
      1,
      Math.ceil((Date.parse(expiresAt) - this.now().getTime()) / 1000),
    );
    if (
      !Number.isFinite(timeoutSeconds) ||
      Date.parse(expiresAt) <= this.now().getTime()
    ) {
      throw new PaymentAdapterError(
        "PAYMENT_EXPIRED",
        "Payment requirement expiration must be in the future.",
      );
    }

    const protocolRequirements = {
      scheme: "exact",
      network: this.network,
      asset: this.assetAddress,
      amount: amount.toString(),
      payTo: request.payTo,
      maxTimeoutSeconds: timeoutSeconds,
      extra: {
        name: this.assetSymbol,
        version: "2",
      },
    } satisfies OfficialPaymentRequirements;
    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: request.resource,
      accepts: [protocolRequirements],
      extensions: {},
    };
    const id = uuid();
    const offer = {
      version: "a2a402-x402-offer/0.1",
      requirementId: id,
      paymentRequired,
      expiresAt,
    };
    const offerSignature = this.signOffer
      ? await this.signOffer(offer)
      : undefined;
    if (offerSignature) {
      paymentRequired.extensions = {
        "a2a402.offer": {
          requirementId: id,
          expiresAt,
          signature: offerSignature,
        },
      };
    }

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
      ...(offerSignature ? { offerSignature } : {}),
      http: {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encodeX402Header(paymentRequired) },
        body: asJsonValue(paymentRequired) as Record<string, JsonValue>,
      },
      protocolData: {
        x402Version: 2,
        paymentRequirements: asJsonValue(protocolRequirements),
        facilitatorUrl: this.facilitatorUrl,
        metadata: request.metadata ?? {},
      },
    };
    this.requirementByIdempotency.set(request.idempotencyKey, {
      fingerprint: inputFingerprint,
      value: requirement,
    });
    return requirement;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerification> {
    const payload = getOfficialPayload(input.payload);
    const payloadFingerprint = sha256(canonicalJson(payload));
    const seenFingerprint = this.paymentFingerprints.get(input.paymentId);
    if (seenFingerprint && seenFingerprint !== payloadFingerprint) {
      return {
        id: uuid(),
        paymentId: input.paymentId,
        requirementId: input.requirement.id,
        valid: false,
        verifiedAt: this.now().toISOString(),
        reason: "PAYMENT_REPLAYED",
      };
    }
    const cached = this.verificationByPaymentId.get(input.paymentId);
    if (cached) return cached;
    const inFlight = this.verificationInFlight.get(input.paymentId);
    if (inFlight) return inFlight;
    this.paymentFingerprints.set(input.paymentId, payloadFingerprint);

    const operation = this.performVerification(input, payload);
    this.verificationInFlight.set(input.paymentId, operation);
    try {
      return await operation;
    } finally {
      this.verificationInFlight.delete(input.paymentId);
    }
  }

  async settlePayment(input: SettlePaymentInput): Promise<PaymentSettlement> {
    const inputFingerprint = sha256(
      canonicalJson({
        requirementId: input.requirement.id,
        verificationId: input.verification.id,
      }),
    );
    const existingByKey = this.settlementByIdempotency.get(
      input.idempotencyKey,
    );
    if (existingByKey) {
      if (existingByKey.fingerprint !== inputFingerprint) {
        throw new PaymentAdapterError(
          "PAYMENT_IDEMPOTENCY_CONFLICT",
          "The settlement idempotency key was reused with different input.",
        );
      }
      return existingByKey.value;
    }
    const cached = this.settlementByPaymentId.get(input.verification.paymentId);
    if (cached) {
      this.settlementByIdempotency.set(input.idempotencyKey, {
        fingerprint: inputFingerprint,
        value: cached,
      });
      return cached;
    }
    const inFlight = this.settlementInFlight.get(input.verification.paymentId);
    if (inFlight) return inFlight;
    const operation = this.performSettlement(input);
    this.settlementInFlight.set(input.verification.paymentId, operation);
    try {
      const settlement = await operation;
      this.settlementByIdempotency.set(input.idempotencyKey, {
        fingerprint: inputFingerprint,
        value: settlement,
      });
      return settlement;
    } finally {
      this.settlementInFlight.delete(input.verification.paymentId);
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<PaymentRefund> {
    if (!this.refundHandler) {
      throw new PaymentAdapterError(
        "PAYMENT_REFUND_UNSUPPORTED",
        "x402 exact settlement is not escrow and has no native refund operation. Configure an explicit testnet refund handler.",
      );
    }
    const transaction =
      this.transactionByHash.get(input.transactionHash) ??
      (await this.getTransaction(input.transactionHash));
    if (!transaction) {
      throw new PaymentAdapterError(
        "PAYMENT_TRANSACTION_NOT_FOUND",
        "The x402 settlement transaction was not found.",
      );
    }
    const remaining =
      BigInt(transaction.amountMinor) - BigInt(transaction.refundedMinor);
    const amount =
      input.amountMinor === undefined
        ? remaining
        : parseMinor(input.amountMinor, "refund_amount_minor");
    const inputFingerprint = sha256(
      canonicalJson({
        transactionHash: input.transactionHash,
        amountMinor: amount.toString(),
        reason: input.reason ?? null,
      }),
    );
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
    if (amount <= 0n || amount > remaining) {
      throw new PaymentAdapterError(
        "PAYMENT_REFUND_EXCEEDS_SETTLEMENT",
        "Refund amount exceeds the unrefunded settlement amount.",
      );
    }
    const response = await this.refundHandler.refund({
      transaction,
      amountMinor: amount.toString(),
      idempotencyKey: input.idempotencyKey,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    const refundedTotal = BigInt(transaction.refundedMinor) + amount;
    const status =
      refundedTotal === BigInt(transaction.amountMinor)
        ? ("refunded" as const)
        : ("partially_refunded" as const);
    transaction.refundedMinor = refundedTotal.toString();
    transaction.status = status;
    transaction.updatedAt = this.now().toISOString();
    const refund: PaymentRefund = {
      id: uuid(),
      transactionHash: input.transactionHash,
      refundTransactionHash: response.transactionHash,
      amountMinor: amount.toString(),
      status,
      refundedAt: transaction.updatedAt,
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
    const local = this.transactionByHash.get(transactionHash);
    if (local) return local;
    if (!this.chainReader) return null;
    const observed = await this.chainReader.getTransaction(transactionHash);
    if (!observed) return null;
    const timestamp = this.now().toISOString();
    return {
      id: uuid(),
      paymentId: "",
      requirementId: "",
      transactionHash,
      network: observed.network,
      asset: observed.asset,
      amountMinor: observed.amountMinor,
      refundedMinor: "0",
      payer: observed.payer,
      payee: observed.payee,
      status: observed.confirmed ? "settled" : "created",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(observed.protocolData ? { protocolData: observed.protocolData } : {}),
    };
  }

  async getWalletBalance(
    address: string,
    asset: string,
  ): Promise<WalletBalance> {
    if (!this.chainReader) {
      throw new PaymentAdapterError(
        "PAYMENT_ADAPTER_UNAVAILABLE",
        "An X402ChainReader is required for on-chain wallet balance queries.",
      );
    }
    return {
      address,
      network: this.network,
      asset,
      balanceMinor: await this.chainReader.getWalletBalance(
        address,
        asset,
        this.network,
      ),
      observedAt: this.now().toISOString(),
    };
  }

  async health(): Promise<PaymentAdapterHealth> {
    try {
      await this.facilitator.getSupported();
      return {
        mode: this.mode,
        healthy: true,
        network: this.network,
        details: {
          facilitator_url: this.facilitatorUrl,
          asset_address: this.assetAddress,
          mainnet_enabled: false,
        },
      };
    } catch (error) {
      return {
        mode: this.mode,
        healthy: false,
        network: this.network,
        details: {
          facilitator_url: this.facilitatorUrl,
          error:
            error instanceof Error ? error.message : "Facilitator unavailable",
        },
      };
    }
  }

  private async performVerification(
    input: VerifyPaymentInput,
    payload: OfficialPaymentPayload,
  ): Promise<PaymentVerification> {
    const requirements = getProtocolRequirement(input.requirement);
    if (
      input.requirement.mode !== this.mode ||
      input.requirement.network !== this.network ||
      input.requirement.asset !== this.assetSymbol ||
      input.requirement.payTo.toLowerCase() !==
        this.platformSettlementAddress.toLowerCase() ||
      Date.parse(input.requirement.expiresAt) <= this.now().getTime() ||
      !matchesRequirement(payload, requirements)
    ) {
      const invalid: PaymentVerification = {
        id: uuid(),
        paymentId: input.paymentId,
        requirementId: input.requirement.id,
        valid: false,
        verifiedAt: this.now().toISOString(),
        reason: "PAYMENT_REQUIREMENT_MISMATCH",
      };
      this.verificationByPaymentId.set(input.paymentId, invalid);
      return invalid;
    }
    const result = await this.facilitator.verify(payload, requirements);
    const verification: PaymentVerification = {
      id: uuid(),
      paymentId: input.paymentId,
      requirementId: input.requirement.id,
      valid: result.isValid,
      ...(result.payer ? { payer: result.payer } : {}),
      verifiedAt: this.now().toISOString(),
      ...(!result.isValid
        ? {
            reason:
              result.invalidReason ??
              result.invalidMessage ??
              "Facilitator rejected the payment.",
          }
        : {}),
      protocolData: asJsonValue(result) as Record<string, JsonValue>,
    };
    this.verificationByPaymentId.set(input.paymentId, verification);
    if (result.isValid) {
      this.officialPayloadByPaymentId.set(input.paymentId, payload);
    }
    return verification;
  }

  private async performSettlement(
    input: SettlePaymentInput,
  ): Promise<PaymentSettlement> {
    const canonicalVerification = this.verificationByPaymentId.get(
      input.verification.paymentId,
    );
    const payload = this.officialPayloadByPaymentId.get(
      input.verification.paymentId,
    );
    if (
      !input.verification.valid ||
      !canonicalVerification ||
      canonicalVerification.id !== input.verification.id ||
      canonicalVerification.requirementId !== input.requirement.id ||
      !payload
    ) {
      throw new PaymentAdapterError(
        "PAYMENT_NOT_VERIFIED",
        "Only a facilitator-verified x402 payload can be settled.",
      );
    }
    const requirements = getProtocolRequirement(input.requirement);
    const result = await this.facilitator.settle(payload, requirements);
    if (!result.success) {
      throw new PaymentAdapterError(
        "PAYMENT_ADAPTER_UNAVAILABLE",
        result.errorReason ??
          result.errorMessage ??
          "The x402 facilitator failed settlement.",
        true,
        { facilitator_result: asJsonValue(result) },
      );
    }
    if (this.chainReader) {
      const observed = await this.chainReader.getTransaction(
        result.transaction,
      );
      if (
        !observed?.confirmed ||
        observed.network !== this.network ||
        observed.asset !== input.requirement.asset ||
        observed.amountMinor !==
          (result.amount ?? input.requirement.amountMinor) ||
        observed.payee.toLowerCase() !==
          input.requirement.payTo.toLowerCase()
      ) {
        throw new PaymentAdapterError(
          "PAYMENT_REQUIREMENT_MISMATCH",
          "The settled Base Sepolia transaction does not match the exact-price requirement.",
          false,
          {
            transaction_hash: result.transaction,
            chain_observation: observed
              ? (asJsonValue(observed) as Record<string, JsonValue>)
              : null,
          },
        );
      }
    }
    const payer = result.payer ?? input.verification.payer;
    if (!payer) {
      throw new PaymentAdapterError(
        "PAYMENT_INVALID",
        "The facilitator settlement response omitted the payer.",
      );
    }
    const settledAt = this.now().toISOString();
    const unsignedReceipt: Omit<PaymentReceipt, "signature"> = {
      version: "a2a402-payment-receipt/0.1",
      paymentId: input.verification.paymentId,
      requirementId: input.requirement.id,
      transactionHash: result.transaction,
      network: result.network,
      asset: input.requirement.asset,
      amountMinor: result.amount ?? input.requirement.amountMinor,
      payer,
      payee: input.requirement.payTo,
      settledAt,
      protocolData: asJsonValue(result) as Record<string, JsonValue>,
    };
    const signature = this.signReceipt
      ? await this.signReceipt(unsignedReceipt)
      : undefined;
    const receipt: PaymentReceipt = {
      ...unsignedReceipt,
      ...(signature ? { signature } : {}),
    };
    const settlement: PaymentSettlement = {
      id: uuid(),
      paymentId: input.verification.paymentId,
      transactionHash: result.transaction,
      status: "settled",
      receipt,
    };
    const transaction: PaymentTransaction = {
      id: uuid(),
      paymentId: input.verification.paymentId,
      requirementId: input.requirement.id,
      transactionHash: result.transaction,
      network: result.network,
      asset: input.requirement.asset,
      amountMinor: result.amount ?? input.requirement.amountMinor,
      refundedMinor: "0",
      payer,
      payee: input.requirement.payTo,
      status: "settled",
      createdAt: input.verification.verifiedAt,
      updatedAt: settledAt,
      protocolData: asJsonValue(result) as Record<string, JsonValue>,
    };
    this.transactionByHash.set(result.transaction, transaction);
    this.settlementByPaymentId.set(input.verification.paymentId, settlement);
    return settlement;
  }
}
