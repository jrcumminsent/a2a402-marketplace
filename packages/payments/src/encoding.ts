import { canonicalJson } from "@a2a402/shared";

export function encodeX402Header(value: unknown): string {
  return Buffer.from(canonicalJson(value), "utf8").toString("base64");
}

export function decodeX402Header(value: string): unknown {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded) as unknown;
}
