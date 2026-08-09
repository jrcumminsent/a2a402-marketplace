import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface SecretProtector {
  protect(secret: string): string;
  unprotect(ciphertext: string): string;
}

export function createSecretProtector(keyMaterial: string): SecretProtector {
  if (keyMaterial.length < 32) {
    throw new Error(
      "WEBHOOK_SECRET_ENCRYPTION_KEY must contain at least 32 characters.",
    );
  }
  const key = createHash("sha256").update(keyMaterial, "utf8").digest();
  return {
    protect(secret) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        "v1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    unprotect(ciphertext) {
      const [version, ivEncoded, tagEncoded, encryptedEncoded, extra] =
        ciphertext.split(".");
      if (
        version !== "v1" ||
        !ivEncoded ||
        !tagEncoded ||
        !encryptedEncoded ||
        extra
      ) {
        throw new Error("Webhook secret ciphertext is malformed.");
      }
      const iv = Buffer.from(ivEncoded, "base64url");
      const tag = Buffer.from(tagEncoded, "base64url");
      const encrypted = Buffer.from(encryptedEncoded, "base64url");
      if (iv.byteLength !== 12 || tag.byteLength !== 16) {
        throw new Error("Webhook secret ciphertext parameters are invalid.");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
