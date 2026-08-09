import type { JsonValue } from "@a2a402/shared";

export type PaymentMode = "mock" | "x402_testnet";
export type PaymentStatus =
  | "created"
  | "verified"
  | "settled"
  | "partially_refunded"
  | "refunded"
  | "failed";

export interface PaymentResource {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirementRequest {
  idempotencyKey: string;
  amountMinor: string | bigint;
  asset: string;
  payTo: string;
  resource: PaymentResource;
  expiresAt?: string;
  metadata?: Record<string, JsonValue>;
}

export interface PaymentRequiredHttpResponse {
  status: 402;
  headers: Record<string, string>;
  body: Record<string, JsonValue>;
}

export interface PaymentRequirement {
  id: string;
  mode: PaymentMode;
  scheme: "exact";
  network: string;
  asset: string;
  amountMinor: string;
  payTo: string;
  resource: PaymentResource;
  createdAt: string;
  expiresAt: string;
  offerSignature?: string;
  http: PaymentRequiredHttpResponse;
  protocolData: Record<string, JsonValue>;
}

export interface VerifyPaymentInput {
  paymentId: string;
  requirement: PaymentRequirement;
  payload: unknown;
}

export interface PaymentVerification {
  id: string;
  paymentId: string;
  requirementId: string;
  valid: boolean;
  payer?: string;
  verifiedAt: string;
  reason?: string;
  protocolData?: Record<string, JsonValue>;
}

export interface SettlePaymentInput {
  idempotencyKey: string;
  requirement: PaymentRequirement;
  verification: PaymentVerification;
}

export interface PaymentReceipt {
  version: "a2a402-payment-receipt/0.1";
  paymentId: string;
  requirementId: string;
  transactionHash: string;
  network: string;
  asset: string;
  amountMinor: string;
  payer: string;
  payee: string;
  settledAt: string;
  signature?: string;
  protocolData?: Record<string, JsonValue>;
}

export interface PaymentSettlement {
  id: string;
  paymentId: string;
  transactionHash: string;
  status: "settled";
  receipt: PaymentReceipt;
}

export interface RefundPaymentInput {
  idempotencyKey: string;
  transactionHash: string;
  amountMinor?: string | bigint;
  reason?: string;
}

export interface PaymentRefund {
  id: string;
  transactionHash: string;
  refundTransactionHash: string;
  amountMinor: string;
  status: "partially_refunded" | "refunded";
  refundedAt: string;
}

export interface PaymentTransaction {
  id: string;
  paymentId: string;
  requirementId: string;
  transactionHash?: string;
  network: string;
  asset: string;
  amountMinor: string;
  refundedMinor: string;
  payer: string;
  payee: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  protocolData?: Record<string, JsonValue>;
}

export interface WalletBalance {
  address: string;
  network: string;
  asset: string;
  balanceMinor: string;
  observedAt: string;
}

export interface PaymentAdapterHealth {
  mode: PaymentMode;
  healthy: boolean;
  network: string;
  details: Record<string, JsonValue>;
}

export interface PaymentAdapter {
  readonly mode: PaymentMode;
  createPaymentRequirement(
    request: PaymentRequirementRequest,
  ): Promise<PaymentRequirement>;
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerification>;
  settlePayment(input: SettlePaymentInput): Promise<PaymentSettlement>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentRefund>;
  getTransaction(transactionHash: string): Promise<PaymentTransaction | null>;
  getWalletBalance(address: string, asset: string): Promise<WalletBalance>;
  health(): Promise<PaymentAdapterHealth>;
}

export type PaymentAdapterErrorCode =
  | "PAYMENT_INVALID"
  | "PAYMENT_REPLAYED"
  | "PAYMENT_EXPIRED"
  | "PAYMENT_NOT_VERIFIED"
  | "PAYMENT_ALREADY_SETTLED"
  | "PAYMENT_INSUFFICIENT_FUNDS"
  | "PAYMENT_REQUIREMENT_MISMATCH"
  | "PAYMENT_UNSUPPORTED_NETWORK"
  | "PAYMENT_UNSUPPORTED_ASSET"
  | "PAYMENT_TRANSACTION_NOT_FOUND"
  | "PAYMENT_REFUND_UNSUPPORTED"
  | "PAYMENT_REFUND_EXCEEDS_SETTLEMENT"
  | "PAYMENT_IDEMPOTENCY_CONFLICT"
  | "PAYMENT_ADAPTER_UNAVAILABLE";

export class PaymentAdapterError extends Error {
  constructor(
    readonly code: PaymentAdapterErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, JsonValue> = {},
  ) {
    super(message);
    this.name = "PaymentAdapterError";
  }
}
