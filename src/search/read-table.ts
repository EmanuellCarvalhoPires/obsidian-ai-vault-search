// Paginated reader for spreadsheets and CSV/TSV files: sheet choice, column projection and markdown/json/csv output.
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { isExcluded } from "./exclusion";
import { carregarConteudo } from "./file-content";
import { ehCaminhoBloqueado, redigirSegredos } from "./protecao";
import { displayPath, isAbsolutePath } from "./path-resolver";
import { columnIndex, columnLetter } from "./tabular-parser";
import type { Aba } from "./xlsx-reader";
import type { UniversalContext } from "./universal-search";

export interface LerTabelaParams {
  arquivo: string;
  aba?: string;
  linha_inicio?: number;
  linha_fim?: number;
  colunas?: string[];
  formato?: "markdown" | "json" | "csv";
}

const EXTENSOES_TABELA = new Set(["csv", "tsv", "xlsx"]);
const LINHA_INICIAL_PADRAO = 2;
const LINHAS_PADRAO = 50;

// Escapes a value for a markdown table cell: pipes and line breaks would break the row.
function celulaMarkdown(valor: string): string {
  return valor.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, " ");
}

// Quotes a value for CSV when it has a comma, a quote or a line break.
function celulaCsv(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

// Resolves the requested column tokens (letters or header names) to 0-based indexes.
function resolverColunas(
  pedidas: string[],
  cabecalho: string[],
  dicas: string[],
): number[] {
  const indices: number[] = [];
  for (const bruto of pedidas) {
    const item = bruto.trim();
    if (item === "") continue;
    // Header name wins over letter: a header "id" must not be read as column I.
    const alvo = item.toLowerCase();
    let indice = cabecalho.findIndex((nome) => nome.trim().toLowerCase() === alvo);
    if (indice < 0 && /^[A-Za-z]{1,3}$/.test(item)) {
      indice = columnIndex(item);
    }
    if (indice < 0) {
      dicas.push(`Coluna '${item}' não encontrada e ignorada`);
      continue;
    }
    if (!indices.includes(indice)) indices.push(indice);
  }
  return indices;
}

// Builds the output table in the requested format.
function montarTabela(
  formato: "markdown" | "json" | "csv",
  nomes: string[],
  indices: number[],
  linhas: string[][],
  inicio: number,
  fim: number,
): string | Record<string, string | number>[] {
  const registros: { linha: number; valores: string[] }[] = [];
  for (let n = inicio; n <= fim; n++) {
    const linha = linhas[n - 1] ?? [];
    registros.push({ linha: n, valores: indices.map((j) => linha[j] ?? "") });
  }

  if (formato === "json") {
    return registros.map((r) => {
      const obj: Record<string, string | number> = { _linha: r.linha };
      nomes.forEach((nome, k) => {
        obj[nome] = r.valores[k] ?? "";
      });
      return obj;
    });
  }

  if (formato === "csv") {
    const cabecalho = nomes.map(celulaCsv).join(",");
    const corpo = registros.map((r) => r.valores.map(celulaCsv).join(","));
    return [cabecalho, ...corpo].join("\n");
  }

  const cabecalho = `| # | ${nomes.map(celulaMarkdown).join(" | ")} |`;
  const separador = `| --- | ${nomes.map(() => "---").join(" | ")} |`;
  const corpo = registros.map(
    (r) => `| ${r.linha} | ${r.valores.map(celulaMarkdown).join(" | ")} |`,
  );
  return [cabecalho, separador, ...corpo].join("\n");
}

// Redacts secrets in the table values, whatever the output format.
function redigirTabela(
  tabela: string | Record<string, string | number>[],
): string | Record<string, string | number>[] {
  if (typeof tabela === "string") return redigirSegredos(tabela);
  return tabela.map((registro) => {
    const seguro: Record<string, string | number> = {};
    for (const [chave, valor] of Object.entries(registro)) {
      seguro[chave] = typeof valor === "string" ? redigirSegredos(valor) : valor;
    }
    return seguro;
  });
}

// Reads a page of a spreadsheet or CSV/TSV file. Relative paths are resolved from the vault base path.
export async function readTable(p: LerTabelaParams, ctx: UniversalContext): Promise<Record<string, unknown>> {
  const erro = (dica: string): Record<string, unknown> => ({ total_linhas: 0, dicas: [dica] });

  const arquivo = p.arquivo.trim();
  const absoluto = isAbsolutePath(arquivo);
  const naoEncontrado = erro(`Arquivo não encontrado: ${arquivo}`);
  if (!absoluto && ctx.basePath === "") return naoEncontrado;

  const abs = absoluto ? arquivo : path.join(ctx.basePath, arquivo);
  // Vault files are compared by their vault-relative path; computer paths are never excluded.
  const caminho = ctx.basePath === "" ? abs.replace(/\\/g, "/") : displayPath(abs, ctx.basePath);
  if (isExcluded(caminho, ctx.excluidas)) return naoEncontrado;
  if (ehCaminhoBloqueado(abs) || ehCaminhoBloqueado(caminho)) {
    return erro("Acesso bloqueado: arquivo de credenciais ou de configuração sensível");
  }

  const info = await stat(abs).catch(() => undefined);
  if (info === undefined || !info.isFile()) return naoEncontrado;

  const nome = path.basename(abs);
  const ext = nome.includes(".") ? nome.slice(nome.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!EXTENSOES_TABELA.has(ext)) return erro("Use arquivo .csv, .tsv ou .xlsx");

  const conteudo = await carregarConteudo(
    { abs, extensao: ext, tamanho: info.size, mtime: info.mtimeMs },
    ctx.conteudo,
  );
  if (conteudo === undefined || conteudo.abas === undefined) {
    return erro("Não foi possível ler a planilha");
  }

  const abas: Aba[] = conteudo.abas;
  const nomesAbas = abas.map((a) => a.nome);
  const dicas: string[] = [];

  let aba: Aba | undefined;
  if (p.aba !== undefined && p.aba.trim() !== "") {
    const alvo = p.aba.trim().toLowerCase();
    aba = abas.find((a) => a.nome.trim().toLowerCase() === alvo);
    if (aba === undefined) {
      return { abas: nomesAbas, dicas: ["Aba não encontrada"] };
    }
  } else {
    aba = abas[0];
  }
  const linhas = aba?.linhas ?? [];
  const cabecalho = linhas[0] ?? [];
  const totalLinhas = Math.max(0, linhas.length - 1);

  // Row numbers are spreadsheet rows (1-based); row 1 is the header and is always shown.
  const inicio = Math.max(LINHA_INICIAL_PADRAO, p.linha_inicio ?? LINHA_INICIAL_PADRAO);
  const fimPedido = p.linha_fim ?? inicio + LINHAS_PADRAO - 1;
  const fim = Math.min(fimPedido, linhas.length);
  if (inicio > linhas.length) {
    dicas.push(`Intervalo fora da planilha (${totalLinhas} linhas de dados)`);
  }

  // Without a valid column list, every column of the widest row is shown.
  let indices: number[] =
    p.colunas !== undefined && p.colunas.length > 0 ? resolverColunas(p.colunas, cabecalho, dicas) : [];
  if (indices.length === 0) {
    const largura = linhas.reduce((max, linha) => Math.max(max, linha.length), 0);
    indices = Array.from({ length: largura }, (_, j) => j);
  }

  const nomes = indices.map((j) => {
    const titulo = (cabecalho[j] ?? "").trim();
    return titulo !== "" ? titulo : columnLetter(j);
  });

  const formato = p.formato ?? "markdown";
  const tabela = redigirTabela(montarTabela(formato, nomes, indices, linhas, inicio, fim));

  const resultado: Record<string, unknown> = {
    arquivo: caminho,
    aba: aba?.nome ?? "",
    total_linhas: totalLinhas,
    linha_inicio: inicio,
    linha_fim: fim,
    colunas: nomes,
    formato,
    tabela,
  };
  if (abas.length > 1) resultado.abas = nomesAbas;
  if (dicas.length > 0) resultado.dicas = dicas;
  return resultado;
}
