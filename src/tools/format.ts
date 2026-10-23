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

/** Formats search matches in ripgrep style: "caminho:linha:trecho". */
export function formatRipgrep(resultados: Array<{
  caminho?: string;
  linha?: number;
  trecho?: string;
  secao_linha?: number;
  secao_trecho?: string;
  conteudo?: string;
}>): string {
  if (!resultados || resultados.length === 0) return "";
  return resultados
    .map((r) => {
      const caminho = r.caminho || "";
      const linha = r.linha ?? r.secao_linha ?? 1;
      let trecho = r.trecho ?? r.secao_trecho ?? r.conteudo ?? "";
      trecho = trecho.replace(/[\r\n]+/g, " ").trim();
      return `${caminho}:${linha}:${trecho}`;
    })
    .join("\n");
}

export function ripgrepResult(payload: { resultados?: any[] }): HubToolResult {
  const text = formatRipgrep(payload.resultados || []);
  return { content: [{ type: "text", text }] };
}

export function errorResult(prefix: string, err: unknown): HubToolResult {
  return { isError: true, content: [{ type: "text", text: `${prefix}: ${String(err)}` }] };
}
