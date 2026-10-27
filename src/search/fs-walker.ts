import { opendir, stat } from "node:fs/promises";
import * as path from "node:path";

// Heavy or system directories that are never walked (names in lowercase).
export const DIRS_IGNORADOS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuget",
  ".cargo",
  "__pycache__",
  ".venv",
  "venv",
  ".git",
  ".svn",
  ".hg",
  "appdata",
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
]);

export interface ArquivoVarrido {
  abs: string;
  nome: string;
  extensao: string;
  tamanho: number;
  mtime: number;
}

export interface OpcoesVarredura {
  extensoes: string[];
  recursivo: boolean;
  maxArquivos?: number;
  ignorarRel?: (relDir: string) => boolean;
  aoCortar?: () => void;
}

export const MAX_ARQUIVOS_PADRAO = 20000;

// Walks a real folder on disk and yields files that match the options.
// Read errors are swallowed: the walker skips the entry and keeps going.
export async function* walkFiles(
  raiz: string,
  opts: OpcoesVarredura,
): AsyncGenerator<ArquivoVarrido> {
  const limite = opts.maxArquivos ?? MAX_ARQUIVOS_PADRAO;
  const extensoes = new Set(
    opts.extensoes.map((e) => e.trim().toLowerCase().replace(/^\./, "")),
  );
  const pilha: Array<{ abs: string; rel: string }> = [{ abs: raiz, rel: "" }];
  let devolvidos = 0;

  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (!atual) break;

    let entradas;
    try {
      entradas = await opendir(atual.abs);
    } catch {
      continue;
    }

    const subpastas: Array<{ abs: string; rel: string }> = [];
    try {
      for await (const entrada of entradas) {
        const abs = path.join(atual.abs, entrada.name);
        const rel = atual.rel === "" ? entrada.name : `${atual.rel}/${entrada.name}`;

        if (entrada.isDirectory()) {
          if (!opts.recursivo) continue;
          const nomeMin = entrada.name.toLowerCase();
          if (DIRS_IGNORADOS.has(nomeMin) || entrada.name.startsWith(".")) continue;
          if (opts.ignorarRel?.(rel)) continue;
          subpastas.push({ abs, rel });
          continue;
        }

        const extensao = path.extname(entrada.name).slice(1).toLowerCase();
        if (extensoes.size > 0 && !extensoes.has(extensao)) continue;

        let info;
        try {
          info = await stat(abs);
        } catch {
          continue;
        }
        if (!info.isFile()) continue;

        // Only a matching file beyond the limit counts as a cut: exactly one warning.
        if (devolvidos >= limite) {
          opts.aoCortar?.();
          return;
        }
        devolvidos += 1;
        yield {
          abs: abs.replace(/\\/g, "/"),
          nome: entrada.name,
          extensao,
          tamanho: info.size,
          mtime: info.mtimeMs,
        };
      }
    } catch {
      // Error while reading this directory: move on to the next one.
    }

    // Push in reverse so the walk visits subfolders in listing order.
    for (let i = subpastas.length - 1; i >= 0; i -= 1) {
      pilha.push(subpastas[i]);
    }
  }
}
