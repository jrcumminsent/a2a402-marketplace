import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { canonicalJson, sha256 } from "@a2a402/shared";

interface PublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  [key: string]: unknown;
}

export class PlatformSigner {
  private readonly privateKey: KeyObject;
  readonly publicJwk: PublicJwk;
  readonly keyId: string;
  readonly ephemeral: boolean;

  constructor(privateKeyPem?: string, configuredKeyId?: string) {
    if (privateKeyPem) {
      this.privateKey = createPrivateKey(privateKeyPem.replaceAll("\\n", "\n"));
      this.ephemeral = false;
    } else {
      this.privateKey = generateKeyPairSync("ed25519").privateKey;
      this.ephemeral = true;
    }
    if (this.privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error("SIGNING_PRIVATE_KEY must be an Ed25519 private key.");
    }
    this.publicJwk = createPublicKey(this.privateKey).export({
      format: "jwk",
    }) as PublicJwk;
    const thumbprint = createHash("sha256")
      .update(
        canonicalJson({
          crv: this.publicJwk.crv,
          kty: this.publicJwk.kty,
          x: this.publicJwk.x,
        }),
      )
      .digest("hex")
      .slice(0, 24);
    this.keyId =
      configuredKeyId ?? `did:web:a2a402.market#settlement-${thumbprint}`;
  }

  sign(value: unknown): { digest: string; signature: string; keyId: string } {
    const serialized = canonicalJson(value);
    const digest = sha256(serialized);
    return {
      digest,
      signature: sign(null, Buffer.from(serialized), this.privateKey).toString(
        "base64url",
      ),
      keyId: this.keyId,
    };
  }

  didDocument(domain: string): Record<string, unknown> {
    return {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/jws-2020/v1",
      ],
      id: `did:web:${domain}`,
      verificationMethod: [
        {
          id: this.keyId,
          type: "JsonWebKey2020",
          controller: `did:web:${domain}`,
          publicKeyJwk: this.publicJwk,
        },
      ],
      assertionMethod: [this.keyId],
      authentication: [this.keyId],
      service: [
        {
          id: `did:web:${domain}#marketplace`,
          type: "AgentMarketplace",
          serviceEndpoint: `https://${domain}`,
        },
      ],
    };
  }
}
