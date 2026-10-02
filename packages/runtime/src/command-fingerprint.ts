import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return { "$hq.bigint": value.toString(10) };
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const record = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }

  return value;
}

export function commandFingerprint(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));

  return createHash("sha256")
    .update(canonical)
    .digest("hex");
}
