export interface JsonPointerResolution {
  found: boolean;
  value: unknown;
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function resolveJsonPointer(
  input: unknown,
  pointer: string,
): JsonPointerResolution {
  if (pointer === "") return { found: true, value: input };
  if (!pointer.startsWith("/")) return { found: false, value: undefined };
  let current: unknown = input;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodePointerToken(rawToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) {
        return { found: false, value: undefined };
      }
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (
      !current ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}
