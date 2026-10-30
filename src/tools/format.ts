// Compact tool responses: one JSON text, no indentation, no empty fields.
import type { HubToolResult } from "../ecosystem/types";
import type { SearchResultPayload } from "../search/types";

/** Top-level keys that stay even when empty, so callers can rely on them. */
const KEEP_ALWAYS = new Set(["total", "resultados"]);

// Campos repetidos ou longos que a resposta enxuta deixa de fora.
const SAIDA_RESULTADO = ["pontos", "modificada", "tags", "up", "nome"];
// Campos do arquivo que o agrupamento tira de cada trecho (ficam no grupo).
const SAIDA_TRECHO = ["caminho", "nome", "extensao", "modificada", "tipo", "tamanho_bytes", "pontos", "tags", "up"];

function semChaves(obj: object, chaves: string[]): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...obj };
  for (const chave of chaves) delete copia[chave];
  return copia;
}

/**
 * Resposta enxuta da busca: sem consulta e sem campos repetidos por resultado.
 * Com agrupar, os trechos do mesmo arquivo viram um grupo só. Com detalhe, nada muda.
 */
export function enxugar(payload: SearchResultPayload, detalhe: boolean, agrupar = false): Record<string, unknown> {
  if (detalhe) return { ...payload };

  const saida: Record<string, unknown> = { ...payload };
  delete saida.consulta;

  if (agrupar) {
    const grupos = new Map<string, { caminho: string; tipo: unknown; trechos: Record<string, unknown>[] }>();
    for (const r of payload.resultados) {
      let grupo = grupos.get(r.caminho);
      if (!grupo) {
        grupo = { caminho: r.caminho, tipo: r.tipo, trechos: [] };
        grupos.set(r.caminho, grupo);
      }
      grupo.trechos.push(semChaves(r, SAIDA_TRECHO));
    }
    saida.resultados = [...grupos.values()];
    return saida;
  }

  saida.resultados = payload.resultados.map((r) => semChaves(r, SAIDA_RESULTADO));
  return saida;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
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

/** Formats search matches in ripgrep style: "caminho:linha:trecho" (no trecho: "caminho:linha" or "caminho"). */
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
      const linhaExibida = r.linha ?? r.secao_linha;
      const trecho = (r.trecho ?? r.secao_trecho ?? r.conteudo ?? "").replace(/[\r\n]+/g, " ").trim();
      if (trecho === "") {
        return linhaExibida !== undefined ? `${caminho}:${linhaExibida}` : caminho;
      }
      return `${caminho}:${linhaExibida ?? 1}:${trecho}`;
    })
    .join("\n");
}

/**
 * Texto compacto da busca. Sem resultados: "0 resultados" com as dicas.
 * Com resultados: as linhas e, no fim, "+N" com os que não couberam.
 */
export function ripgrepResult(payload: {
  resultados?: Parameters<typeof formatRipgrep>[0];
  total?: number;
  dicas?: string[];
  restantes?: number;
  truncado?: boolean;
}): HubToolResult {
  const resultados = payload.resultados || [];
  if (resultados.length === 0) {
    const linhas = ["0 resultados", ...(payload.dicas ?? []).map((d) => `- ${d}`)];
    return { content: [{ type: "text", text: linhas.join("\n") }] };
  }

  const linhas = [formatRipgrep(resultados)];
  const restantes = payload.restantes ?? Math.max(0, (payload.total ?? resultados.length) - resultados.length);
  if (restantes > 0) {
    linhas.push(`+${restantes}`);
  } else if (payload.truncado === true) {
    linhas.push("+");
  }
  return { content: [{ type: "text", text: linhas.join("\n") }] };
}

export function errorResult(prefix: string, err: unknown): HubToolResult {
  return { isError: true, content: [{ type: "text", text: `${prefix}: ${String(err)}` }] };
}
