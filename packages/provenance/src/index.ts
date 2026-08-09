import {
  canonicalJson,
  MarketplaceError,
  nowIso,
  sha256,
  uuid,
} from "@a2a402/shared";
import { verifyMessage } from "viem";

export interface EarningAttestation {
  id: string;
  version: "a2a402-earning-attestation/0.1";
  issuerAgentId: string;
  recipientAgentId: string;
  recipientWallet: `0x${string}`;
  workDescriptionHash: string;
  deliverableHash: string;
  paymentTransactionHash: string;
  amountMinor: bigint;
  asset: string;
  earnedAt: string;
  replayProtectionId: string;
  issuerWallet: `0x${string}`;
  issuerSignature: `0x${string}`;
}

export interface ChainTransaction {
  hash: string;
  from: string;
  to: string;
  amountMinor: bigint;
  asset: string;
  network: string;
  confirmed: boolean;
}

export interface ExternalEarningVerification {
  verified: boolean;
  classification:
    "verified_external_agent_earned" | "platform_test_funds" | "unknown";
  verifier: string;
  transaction: ChainTransaction | null;
  reasons: string[];
}

export interface ExternalEarningVerifier {
  readonly name: string;
  verify(attestation: EarningAttestation): Promise<ExternalEarningVerification>;
}

export function earningAttestationPayload(
  input: Omit<EarningAttestation, "id" | "issuerSignature">,
): string {
  return [
    "a2a402.market external earning attestation",
    canonicalJson({ ...input, amountMinor: input.amountMinor.toString() }),
  ].join("\n");
}

export class DeterministicTestVerifier implements ExternalEarningVerifier {
  readonly name = "deterministic-test-verifier";

  async verify(
    attestation: EarningAttestation,
  ): Promise<ExternalEarningVerification> {
    const reasons: string[] = [];
    if (!attestation.paymentTransactionHash.startsWith("test:")) {
      reasons.push("Test transaction hash must begin with test:.");
    }
    if (attestation.issuerAgentId === attestation.recipientAgentId) {
      reasons.push("Self-attestation is prohibited.");
    }
    if (attestation.amountMinor <= 0n) reasons.push("Amount must be positive.");
    const verified = reasons.length === 0;
    return {
      verified,
      classification: verified ? "platform_test_funds" : "unknown",
      verifier: this.name,
      transaction: verified
        ? {
            hash: attestation.paymentTransactionHash,
            from: attestation.issuerWallet,
            to: attestation.recipientWallet,
            amountMinor: attestation.amountMinor,
            asset: attestation.asset,
            network: "simulation",
            confirmed: true,
          }
        : null,
      reasons,
    };
  }
}

export class AllowlistedSignedAttestationVerifier implements ExternalEarningVerifier {
  readonly name = "allowlisted-signed-attestation";

  constructor(
    private readonly allowlistedIssuers: ReadonlySet<string>,
    private readonly getTransaction: (
      hash: string,
    ) => Promise<ChainTransaction | null>,
  ) {}

  async verify(
    attestation: EarningAttestation,
  ): Promise<ExternalEarningVerification> {
    const reasons: string[] = [];
    if (attestation.issuerAgentId === attestation.recipientAgentId) {
      reasons.push("Self-attestation is prohibited.");
    }
    if (!this.allowlistedIssuers.has(attestation.issuerAgentId)) {
      reasons.push("Issuer is not allowlisted.");
    }
    const unsigned = { ...attestation };
    delete (unsigned as Partial<EarningAttestation>).id;
    delete (unsigned as Partial<EarningAttestation>).issuerSignature;
    const signatureValid = await verifyMessage({
      address: attestation.issuerWallet,
      message: earningAttestationPayload(
        unsigned as Omit<EarningAttestation, "id" | "issuerSignature">,
      ),
      signature: attestation.issuerSignature,
    }).catch(() => false);
    if (!signatureValid) reasons.push("Issuer signature is invalid.");
    const transaction = await this.getTransaction(
      attestation.paymentTransactionHash,
    );
    if (!transaction?.confirmed)
      reasons.push("Referenced transaction is not confirmed.");
    if (
      transaction &&
      (transaction.from.toLowerCase() !==
        attestation.issuerWallet.toLowerCase() ||
        transaction.to.toLowerCase() !==
        attestation.recipientWallet.toLowerCase() ||
        transaction.amountMinor !== attestation.amountMinor ||
        transaction.asset !== attestation.asset)
    ) {
      reasons.push("Referenced transaction does not match the attestation.");
    }
    const verified = reasons.length === 0;
    return {
      verified,
      classification: verified ? "verified_external_agent_earned" : "unknown",
      verifier: this.name,
      transaction,
      reasons,
    };
  }
}

export function newAttestation(
  input: Omit<EarningAttestation, "id" | "version">,
): EarningAttestation {
  if (input.amountMinor <= 0n) {
    throw new MarketplaceError(
      "PROVENANCE_INVALID",
      "Attestation amount must be positive.",
    );
  }
  return { ...input, id: uuid(), version: "a2a402-earning-attestation/0.1" };
}

export function provenanceDigest(attestation: EarningAttestation): string {
  return sha256(
    canonicalJson({
      ...attestation,
      amountMinor: attestation.amountMinor.toString(),
    }),
  );
}

export function testAttestationTemplate(
  recipientAgentId: string,
  recipientWallet: `0x${string}`,
  issuerAgentId: string,
  issuerWallet: `0x${string}`,
  amountMinor: bigint,
): Omit<EarningAttestation, "issuerSignature"> {
  return {
    id: uuid(),
    version: "a2a402-earning-attestation/0.1",
    issuerAgentId,
    recipientAgentId,
    recipientWallet,
    workDescriptionHash: sha256("deterministic simulation work"),
    deliverableHash: sha256("deterministic simulation delivery"),
    paymentTransactionHash: `test:${uuid()}`,
    amountMinor,
    asset: "USDC",
    earnedAt: nowIso(),
    replayProtectionId: uuid(),
    issuerWallet,
  };
}
