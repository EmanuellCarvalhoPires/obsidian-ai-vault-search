// Blocklist of sensitive files and secret redaction for everything the tools return.
import type { SearchMatch } from "./types";

export const MARCA_REDIGIDO = "[REDIGIDO]";

const ID_SSH = /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/;
const PLUGIN_DATA = /(^|\/)\.obsidian\/plugins\/[^/]+\/data\.json$/;

// True for credential, key and config files that no tool may read or list.
export function ehCaminhoBloqueado(caminho: string): boolean {
  const normal = caminho.replace(/\\/g, "/").toLowerCase();
  const segmentos = normal.split("/").filter((s) => s !== "");
  const base = segmentos[segmentos.length - 1] ?? "";

  if (base.startsWith(".credentials")) return true;
  if (base.startsWith(".env")) return true;
  if (base.endsWith(".pem")) return true;
  if (ID_SSH.test(base)) return true;
  if (segmentos.some((s) => s === ".ssh" || s === ".aws")) return true;
  if (base === ".npmrc") return true;
  return PLUGIN_DATA.test(normal);
}

// Known token shapes replaced by the mark. Bearer keeps its word, so it is handled apart.
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/=-]{16,}/gi;
const SEGREDOS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
];

// Replaces known secret shapes in a text. Applying it twice gives the same result.
export function redigirSegredos(texto: string): string {
  let saida = texto.replace(BEARER, `Bearer ${MARCA_REDIGIDO}`);
  for (const padrao of SEGREDOS) {
    saida = saida.replace(padrao, MARCA_REDIGIDO);
  }
  return saida;
}

const CAMPOS_TEXTO = ["conteudo", "trecho", "secao_trecho", "valor"] as const;

// Copy of a match with secrets redacted in its text fields. The original is not changed.
export function redigirMatch(m: SearchMatch): SearchMatch {
  const copia: SearchMatch = { ...m };
  for (const campo of CAMPOS_TEXTO) {
    const valor = copia[campo];
    if (typeof valor === "string") copia[campo] = redigirSegredos(valor);
  }
  return copia;
}
