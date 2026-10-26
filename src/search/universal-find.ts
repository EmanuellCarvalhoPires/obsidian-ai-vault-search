// Filename search: finds files by name or path in the vault or in any folder on the computer.
import * as path from "node:path";
import { isExcluded } from "./exclusion";
import { walkFiles } from "./fs-walker";
import { displayPath, relativoAoCofre, resolveScope, toAbsolute } from "./path-resolver";
import { normalizar } from "./text-search";
import type { SearchMatch, SearchResultPayload } from "./types";
import type { UniversalContext } from "./universal-search";

export interface BuscaNomeParams {
  query: string;
  extensoes: string[];
  pasta?: string;
  limite: number;
}

// Scores a file by its name (without extension) and path. Returns 0 when no token matches.
export function pontuarNome(nomeBase: string, caminho: string, query: string): number {
  const normQuery = normalizar(query);
  const tokens = normQuery.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;

  const normBase = normalizar(nomeBase);
  const normCaminho = normalizar(caminho);

  let casadosNoNome = 0;
  let casadosTotal = 0;
  for (const token of tokens) {
    const noNome = normBase.includes(token);
    if (noNome) casadosNoNome++;
    if (noNome || normCaminho.includes(token)) casadosTotal++;
  }
  if (casadosTotal === 0) return 0;

  let pontos: number;
  if (casadosNoNome === tokens.length) {
    pontos = 100;
    if (normBase === normQuery) {
      pontos += 50;
    } else if (normBase.includes(normQuery)) {
      pontos += 30;
    }
    pontos -= Math.min(normBase.length, 25);
  } else if (casadosTotal === tokens.length) {
    pontos = 60;
    if (normCaminho.includes(normQuery)) pontos += 15;
  } else {
    pontos = Math.round((casadosTotal / tokens.length) * 40);
  }
  return Math.max(1, pontos);
}

interface Achado {
  resultado: SearchMatch;
  pontos: number;
  mtime: number;
}

// Finds files whose name or path matches the query, in every folder under the scope. Stops at `limite` results.
export async function findUniversal(
  p: BuscaNomeParams,
  ctx: Pick<UniversalContext, "basePath" | "excluidas">,
): Promise<SearchResultPayload> {
  const inicio = Date.now();
  const consulta: Record<string, unknown> = {
    acao: "buscar_rapida",
    query: p.query,
    extensoes: p.extensoes,
    pasta: p.pasta,
    limite: p.limite,
    modo: "universal",
  };
  const vazio = (dicas?: string[]): SearchResultPayload => ({
    consulta,
    total: 0,
    resultados: [],
    ...(dicas !== undefined ? { dicas } : {}),
    tempo_ms: Date.now() - inicio,
  });

  const escopo = resolveScope(p.pasta);
  if (escopo.tipo === "cofre" && ctx.basePath === "") {
    return vazio(["Caminho do cofre indisponível"]);
  }
  // Folders inside the vault are excluded for relative and absolute paths alike.
  const relBase =
    escopo.tipo === "cofre" ? escopo.rel : relativoAoCofre(escopo.abs, ctx.basePath);
  if (relBase !== undefined && isExcluded(relBase, ctx.excluidas)) {
    return vazio();
  }

  const raiz = toAbsolute(escopo, ctx.basePath);
  const ignorarRel =
    relBase === undefined
      ? undefined
      : (relDir: string): boolean =>
          isExcluded(relBase === "" ? relDir : `${relBase}/${relDir}`, ctx.excluidas);

  // Computer scope: full absolute path with "/". Vault scope: path relative to the vault.
  const caminhoDe = (abs: string): string =>
    escopo.tipo === "fs" ? abs.replace(/\\/g, "/") : displayPath(abs, ctx.basePath);

  const temQuery = normalizar(p.query) !== "";
  const achados: Achado[] = [];
  const varredura = walkFiles(raiz, {
    extensoes: p.extensoes,
    recursivo: true,
    ignorarRel,
  });
  for await (const arq of varredura) {
    const nomeBase = path.parse(arq.nome).name;
    const pontos = temQuery
      ? pontuarNome(nomeBase, displayPath(arq.abs, ctx.basePath), p.query)
      : 0;
    if (temQuery && pontos === 0) continue;

    const resultado: SearchMatch = {
      tipo: "arquivo",
      caminho: caminhoDe(arq.abs),
      nome: arq.nome,
      extensao: arq.extensao,
      tamanho_bytes: arq.tamanho,
      modificada: new Date(arq.mtime).toLocaleString("pt-BR"),
    };
    if (temQuery) resultado.pontos = pontos;
    achados.push({ resultado, pontos, mtime: arq.mtime });
  }

  achados.sort((a, b) => b.pontos - a.pontos || b.mtime - a.mtime);
  const total = achados.length;
  const resultados = achados.slice(0, p.limite).map((a) => a.resultado);

  return {
    consulta,
    total,
    resultados,
    tempo_ms: Date.now() - inicio,
  };
}
