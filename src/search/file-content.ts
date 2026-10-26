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

  const limite = BINARIAS.has(ext) ? LIMITE_BINARIO_BYTES : LIMITE_TEXTO_BYTES;
  if (arq.tamanho > limite) return undefined;

  try {
    const conteudo = await lerConteudo(arq.abs, ext, tipo, deps);
    if (conteudo !== undefined) {
      deps.cache.set(arq.abs, arq.mtime, arq.tamanho, conteudo);
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

  const texto = (await readFile(abs, "utf8")).replace(/^﻿/, "");
  const linhas = texto.split(/\r?\n/);
  if (ext === "csv" || ext === "tsv") {
    const { linhas: celulas } = parseDelimited(texto);
    return { tipo, linhas, abas: [{ nome: "", linhas: celulas }] };
  }
  return { tipo, linhas };
}
