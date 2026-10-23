// Compact tool responses: one JSON text, no indentation, no empty fields.
import type { HubToolResult } from "../ecosystem/types";

/** Top-level keys that stay even when empty, so callers can rely on them. */
const KEEP_ALWAYS = new Set(["total", "resultados"]);

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Recursively drops undefined, null, "", [] and {} (booleans and numbers, including 0, stay). */
export function compact(value: unknown, top = false): unknown {
  if (Array.isArray(value)) return value.map((v) => compact(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compact(v);
      if (isEmpty(c) && !(top && KEEP_ALWAYS.has(k))) continue;
      out[k] = c;
    }
    return out;
  }
  return value;
}

/** Tool result carrying the payload once, as compact JSON text (no structuredContent duplicate). */
export function jsonResult(payload: unknown): HubToolResult {
  return { content: [{ type: "text", text: JSON.stringify(compact(payload, true)) }] };
}

export function errorResult(prefix: string, err: unknown): HubToolResult {
  return { isError: true, content: [{ type: "text", text: `${prefix}: ${String(err)}` }] };
}
