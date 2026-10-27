// Filename search: finds files by name or path in the vault or in any folder on the computer.
import * as path from "node:path";
import { isExcluded } from "./exclusion";
import { walkFiles } from "./fs-walker";
import { ehCaminhoBloqueado } from "./protecao";
import { displayPath, relativoAoCofre, resolveScope, toAbsolute } from "./path-resolver";
import { normalizar } from "./text-search";
import type { SearchMatch, SearchResultPayload } from "./types";
import type { UniversalContext } from "./universal-search";

export interface BuscaNomeParams {
  query: string;
  extensoes: string[];
  pasta?: string;
  limite: number;
  offset?: number;
}

export interface PontuacaoNome {
  pontos: number;
  // Query terms that matched the name or the path.
  casados: number;
  tokens: number;
}

// Scores a file by its name (without extension) and path. Pontos is 0 when no token matches.
export function pontuarNomeDetalhado(nomeBase: string, caminho: string, query: string): PontuacaoNome {
  const normQuery = normalizar(query);
  const tokens = normQuery.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { pontos: 0, casados: 0, tokens: 0 };

  const normBase = normalizar(nomeBase);
  const normCaminho = normalizar(caminho);

  let casadosNoNome = 0;
  let casadosTotal = 0;
  for (const token of tokens) {
    const noNome = normBase.includes(token);
    if (noNome) casadosNoNome++;
    if (noNome || normCaminho.includes(token)) casadosTotal++;
  }
  if (casadosTotal === 0) return { pontos: 0, casados: 0, tokens: tokens.length };

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
  return { pontos: Math.max(1, pontos), casados: casadosTotal, tokens: tokens.length };
}

// Same score as pontuarNomeDetalhado, just the number.
export function pontuarNome(nomeBase: string, caminho: string, query: string): number {
  return pontuarNomeDetalhado(nomeBase, caminho, query).pontos;
}

// With a full match, drops hits that matched less than half the terms. Otherwise no filter.
export function filtrarBaixaPontuacao<T extends { casados: number; tokens: number }>(achados: T[]): T[] {
  const temCompleto = achados.some((a) => a.casados === a.tokens);
  if (!temCompleto) return achados;
  return achados.filter((a) => a.casados * 2 >= a.tokens);
}

interface Achado {
  resultado: SearchMatch;
  pontos: number;
  mtime: number;
  casados: number;
  tokens: number;
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
  if (ehCaminhoBloqueado(raiz)) return vazio();
  const ignorarRel =
    relBase === undefined
      ? undefined
      : (relDir: string): boolean =>
          isExcluded(relBase === "" ? relDir : `${relBase}/${relDir}`, ctx.excluidas);

  // Computer scope: full absolute path with "/". Vault scope: path relative to the vault.
  const caminhoDe = (abs: string): string =>
    escopo.tipo === "fs" ? abs.replace(/\\/g, "/") : displayPath(abs, ctx.basePath);

  const temQuery = normalizar(p.query) !== "";
  let achados: Achado[] = [];
  const varredura = walkFiles(raiz, {
    extensoes: p.extensoes,
    recursivo: true,
    ignorarRel,
  });
  for await (const arq of varredura) {
    if (ehCaminhoBloqueado(arq.abs)) continue;
    const nomeBase = path.parse(arq.nome).name;
    const detalhe = temQuery
      ? pontuarNomeDetalhado(nomeBase, displayPath(arq.abs, ctx.basePath), p.query)
      : { pontos: 0, casados: 0, tokens: 0 };
    if (temQuery && detalhe.pontos === 0) continue;
    const pontos = detalhe.pontos;

    const resultado: SearchMatch = {
      tipo: "arquivo",
      caminho: caminhoDe(arq.abs),
      nome: arq.nome,
      extensao: arq.extensao,
      tamanho_bytes: arq.tamanho,
      modificada: new Date(arq.mtime).toLocaleString("pt-BR"),
    };
    if (temQuery) resultado.pontos = pontos;
    achados.push({ resultado, pontos, mtime: arq.mtime, casados: detalhe.casados, tokens: detalhe.tokens });
  }

  // Without a query there is no score to filter on.
  if (temQuery) achados = filtrarBaixaPontuacao(achados);
  achados.sort((a, b) => b.pontos - a.pontos || b.mtime - a.mtime);
  const total = achados.length;
  const offset = Math.max(0, Math.floor(p.offset ?? 0));
  const resultados = achados.slice(offset, offset + p.limite).map((a) => a.resultado);
  const restantes = Math.max(0, total - offset - resultados.length);

  return {
    consulta,
    total,
    resultados,
    ...(restantes > 0 ? { restantes } : {}),
    tempo_ms: Date.now() - inicio,
  };
}
