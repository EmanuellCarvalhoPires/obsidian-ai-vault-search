// Unified content loader: reads a file from disk and returns its content interpreted by type, using the cache.

import { readFile } from "node:fs/promises";
import type { ContentCache } from "./content-cache";
import { parseDelimited } from "./tabular-parser";
import { parseDocx, type Paragrafo } from "./docx-reader";
import { extractPdfPages, type PdfLoader } from "./pdf-reader";
import { tipoDoArquivo, type TipoArquivo } from "./extensions";
import { parseXlsx, type Aba } from "./xlsx-reader";

export interface Conteudo {
  tipo: TipoArquivo;
  linhas?: string[];
  abas?: Aba[];
  paragrafos?: Paragrafo[];
  paginas?: string[];
}

export interface ConteudoDeps {
  cache: ContentCache<Conteudo>;
  pdfLoader: PdfLoader;
}

export interface ArquivoRef {
  abs: string;
  extensao: string;
  tamanho: number;
  mtime: number;
}

export const LIMITE_TEXTO_BYTES = 5 * 1024 * 1024;
export const LIMITE_BINARIO_BYTES = 50 * 1024 * 1024;

const BINARIAS = new Set(["xlsx", "docx", "pdf"]);

// True when the file is larger than what the reader accepts for its extension.
export function excedeLimiteDeTamanho(extensao: string, tamanho: number): boolean {
  const ext = extensao.trim().toLowerCase();
  return tamanho > (BINARIAS.has(ext) ? LIMITE_BINARIO_BYTES : LIMITE_TEXTO_BYTES);
}

// Rough memory estimate of a loaded content, used by the cache byte limit.
export function estimarBytes(c: Conteudo): number {
  let caracteres = 0;
  for (const linha of c.linhas ?? []) caracteres += linha.length + 1;
  for (const aba of c.abas ?? []) {
    for (const linha of aba.linhas) {
      for (const celula of linha) caracteres += celula.length;
    }
  }
  for (const paragrafo of c.paragrafos ?? []) caracteres += paragrafo.texto.length;
  for (const pagina of c.paginas ?? []) caracteres += pagina.length;
  return 64 + 2 * caracteres;
}

// Reads and interprets one file. Returns undefined for unsupported types, oversized files and any read error.
export async function carregarConteudo(
  arq: ArquivoRef,
  deps: ConteudoDeps,
): Promise<Conteudo | undefined> {
  const emCache = deps.cache.get(arq.abs, arq.mtime, arq.tamanho);
  if (emCache !== undefined) return emCache;

  const ext = arq.extensao.trim().toLowerCase();
  const tipo = tipoDoArquivo(ext);
  if (tipo === "outro") return undefined;

  if (excedeLimiteDeTamanho(ext, arq.tamanho)) return undefined;

  try {
    const conteudo = await lerConteudo(arq.abs, ext, tipo, deps);
    if (conteudo !== undefined) {
      deps.cache.set(arq.abs, arq.mtime, arq.tamanho, conteudo, estimarBytes(conteudo));
    }
    return conteudo;
  } catch {
    return undefined;
  }
}

async function lerConteudo(
  abs: string,
  ext: string,
  tipo: TipoArquivo,
  deps: ConteudoDeps,
): Promise<Conteudo> {
  if (ext === "pdf") {
    const dados = await readFile(abs);
    const paginas = await extractPdfPages(new Uint8Array(dados), deps.pdfLoader);
    return { tipo, paginas };
  }
  if (ext === "docx") {
    const paragrafos = await parseDocx(await readFile(abs));
    return { tipo, paragrafos };
  }
  if (ext === "xlsx") {
    const abas = await parseXlsx(await readFile(abs));
    return { tipo, abas };
  }

  const texto = (await readFile(abs, "utf8")).replace(/^\uFEFF/, "");
  const linhas = texto.split(/\r?\n/);
  if (ext === "csv" || ext === "tsv") {
    const { linhas: celulas } = parseDelimited(texto);
    return { tipo, linhas, abas: [{ nome: "", linhas: celulas }] };
  }
  return { tipo, linhas };
}
