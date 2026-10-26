// Universal search: finds terms inside code, text, spreadsheets and documents, in the vault or any folder on the computer.
import { walkFiles } from "./fs-walker";
import { isExcluded } from "./exclusion";
import { carregarConteudo, type Conteudo, type ConteudoDeps } from "./file-content";
import { tipoDoArquivo } from "./extensions";
import { displayPath, relativoAoCofre, resolveScope, toAbsolute } from "./path-resolver";
import { cellRef, columnLetter } from "./tabular-parser";
import { normalizar, searchText } from "./text-search";
import type { SearchMatch, SearchResultPayload } from "./types";

export interface UniversalContext {
  basePath: string;
  excluidas: string[];
  conteudo: ConteudoDeps;
}

export interface BuscaUniversalParams {
  termos: string[];
  extensoes: string[];
  pasta?: string;
  recursivo: boolean;
  limite: number;
}

const TAMANHO_TRECHO = 200;
const TRECHOS_POR_ARQUIVO = 3;

interface DadosArquivo {
  caminho: string;
  nome: string;
  extensao: string;
  modificada: string;
}

function cortar(texto: string): string {
  return texto.trim().slice(0, TAMANHO_TRECHO);
}

// Adds the matches of one loaded file to `saida`, never going past `limite` results in total.
function coletar(
  saida: SearchMatch[],
  dados: DadosArquivo,
  conteudo: Conteudo,
  termos: string[],
  limite: number,
): void {
  const alvos = termos.map(normalizar);
  const casa = (texto: string): boolean => {
    const normalizado = normalizar(texto);
    return alvos.some((alvo) => normalizado.includes(alvo));
  };
  const cheio = (): boolean => saida.length >= limite;

  if (conteudo.tipo === "codigo" || conteudo.tipo === "texto" || conteudo.tipo === "nota") {
    const trechos = searchText((conteudo.linhas ?? []).join("\n"), termos, {
      extensao: dados.extensao,
      max: TRECHOS_POR_ARQUIVO,
    });
    for (const achado of trechos) {
      if (cheio()) return;
      const resultado: SearchMatch = {
        ...dados,
        tipo: conteudo.tipo === "codigo" ? "codigo" : "texto",
        linha: achado.linha,
        trecho: achado.trecho,
      };
      if (achado.simbolo_envolvente !== undefined) {
        resultado.simbolo_envolvente = achado.simbolo_envolvente;
      }
      saida.push(resultado);
    }
    return;
  }

  if (conteudo.tipo === "tabela") {
    for (const aba of conteudo.abas ?? []) {
      const cabecalho = aba.linhas[0] ?? [];
      for (let i = 0; i < aba.linhas.length; i++) {
        const linha = aba.linhas[i];
        for (let j = 0; j < linha.length; j++) {
          if (cheio()) return;
          const valor = linha[j];
          if (!casa(valor)) continue;

          const resultado: SearchMatch = {
            ...dados,
            tipo: "tabela",
            celula: cellRef(j, i + 1),
            linha: i + 1,
            coluna: columnLetter(j),
            valor,
            trecho: montarTrechoLinha(linha, cabecalho, i + 1),
          };
          if (aba.nome !== "") resultado.aba = aba.nome;
          const nomeColuna = cabecalho[j];
          if (nomeColuna !== undefined && nomeColuna !== "" && nomeColuna !== valor) {
            resultado.coluna_nome = nomeColuna;
          }
          saida.push(resultado);
        }
      }
    }
    return;
  }

  if (conteudo.paragrafos !== undefined) {
    let secaoTitulo: string | undefined;
    for (const paragrafo of conteudo.paragrafos) {
      if (cheio()) return;
      if (casa(paragrafo.texto)) {
        const resultado: SearchMatch = {
          ...dados,
          tipo: "documento",
          paragrafo: paragrafo.indice,
          trecho: cortar(paragrafo.texto),
        };
        if (secaoTitulo !== undefined) resultado.secao_titulo = secaoTitulo;
        saida.push(resultado);
      }
      if (paragrafo.nivel !== undefined) secaoTitulo = paragrafo.texto.trim();
    }
    return;
  }

  if (conteudo.paginas !== undefined) {
    for (let n = 0; n < conteudo.paginas.length; n++) {
      if (cheio()) return;
      const linhaCasa = conteudo.paginas[n].split(/\r?\n/).find((l) => casa(l));
      if (linhaCasa === undefined) continue;
      saida.push({
        ...dados,
        tipo: "documento",
        pagina: n + 1,
        trecho: cortar(linhaCasa),
      });
    }
  }
}

// Whole spreadsheet row as "Linha N: [cabecalho: valor | ...]", with the column letter when there is no header.
// Empty cells are kept, and so are the header columns missing from a short row, so every column appears in the snippet.
function montarTrechoLinha(linha: string[], cabecalho: string[], numero: number): string {
  const partes: string[] = [];
  const total = Math.max(linha.length, cabecalho.length);
  for (let k = 0; k < total; k++) {
    const nome = cabecalho[k] !== undefined && cabecalho[k] !== "" ? cabecalho[k] : columnLetter(k);
    partes.push(`${nome}: ${linha[k] ?? ""}`);
  }
  return `Linha ${numero}: [${partes.join(" | ")}]`;
}

// Searches the terms in every supported file under the scope. Stops at `limite` results.
export async function searchUniversal(
  p: BuscaUniversalParams,
  ctx: UniversalContext,
): Promise<SearchResultPayload> {
  const inicio = Date.now();
  const consulta: Record<string, unknown> = {
    acao: "buscar",
    termos: p.termos,
    extensoes: p.extensoes,
    pasta: p.pasta,
    recursivo: p.recursivo,
    modo: "universal",
  };
  const vazio = (dicas?: string[]): SearchResultPayload => ({
    consulta,
    total: 0,
    resultados: [],
    ...(dicas !== undefined ? { dicas } : {}),
    tempo_ms: Date.now() - inicio,
  });

  const termos = p.termos.filter((t) => normalizar(t) !== "");
  if (termos.length === 0) return vazio(["Informe ao menos um termo"]);

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

  const resultados: SearchMatch[] = [];
  const varredura = walkFiles(raiz, {
    extensoes: p.extensoes,
    recursivo: p.recursivo,
    ignorarRel,
  });
  for await (const arq of varredura) {
    if (resultados.length >= p.limite) break;
    if (tipoDoArquivo(arq.extensao) === "outro") continue;

    const conteudo = await carregarConteudo(
      { abs: arq.abs, extensao: arq.extensao, tamanho: arq.tamanho, mtime: arq.mtime },
      ctx.conteudo,
    );
    if (conteudo === undefined) continue;

    coletar(
      resultados,
      {
        caminho: caminhoDe(arq.abs),
        nome: arq.nome,
        extensao: arq.extensao,
        modificada: new Date(arq.mtime).toLocaleString("pt-BR"),
      },
      conteudo,
      termos,
      p.limite,
    );
  }

  return {
    consulta,
    total: resultados.length,
    resultados,
    tempo_ms: Date.now() - inicio,
  };
}
