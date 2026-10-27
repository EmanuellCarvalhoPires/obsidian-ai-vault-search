// Universal read: reads one section or line/page range of a file, in the vault or anywhere on the computer.
import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { Paragrafo } from "./docx-reader";
import { isExcluded } from "./exclusion";
import { carregarConteudo } from "./file-content";
import { tipoDoArquivo } from "./extensions";
import { displayPath, isAbsolutePath } from "./path-resolver";
import { extractSymbolBlock, listSymbols } from "./symbols";
import { ehCaminhoBloqueado, redigirMatch } from "./protecao";
import { escolherCabecalho } from "./cabecalho";
import type { SearchMatch, SearchResultPayload } from "./types";
import type { UniversalContext } from "./universal-search";

export interface LeituraParams {
  arquivo: string;
  secao?: string;
  linha_inicio?: number;
  linha_fim?: number;
  pagina_inicio?: number;
  pagina_fim?: number;
}

// Result of reading one file: either a match, or a list of hints explaining why there is none.
interface Saida {
  achado?: SearchMatch;
  dicas?: string[];
}

interface Cabecalho {
  nivel: number;
  titulo: string;
  linha: number;
}

const LINHAS_PADRAO = 200;
const CABECALHO_MD = /^(#{1,6})\s+(.*)$/;
// Opening or closing code fence: three or more backticks or tildes.
const CERCA_MD = /^\s{0,3}(\x60{3,}|~{3,})/;

// Number of lines, not counting the empty string left after a final newline.
function contarLinhas(linhas: string[]): number {
  return linhas.length > 0 && linhas[linhas.length - 1] === "" ? linhas.length - 1 : linhas.length;
}

// Clips a 1-based inclusive range to 1..total. Missing start is 1, missing end is total.
function intervalo(total: number, inicio?: number, fim?: number): { inicio: number; fim: number } | undefined {
  const a = Math.max(1, inicio ?? 1);
  const b = Math.min(total, fim ?? total);
  if (a > total || b < a) return undefined;
  return { inicio: a, fim: b };
}

function temIntervalo(p: LeituraParams): boolean {
  return p.linha_inicio !== undefined || p.linha_fim !== undefined;
}

// Headings of a markdown note. The frontmatter and the lines inside code fences are not headings.
function cabecalhosMd(linhas: string[]): Cabecalho[] {
  const saida: Cabecalho[] = [];

  let inicio = 0;
  if (linhas[0]?.trim() === "---") {
    const fecha = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (fecha > 0) inicio = fecha + 1;
  }

  let cerca: { char: string; tamanho: number } | undefined;
  for (let i = inicio; i < linhas.length; i++) {
    const texto = linhas[i];
    const marca = CERCA_MD.exec(texto);

    if (cerca !== undefined) {
      // A closing fence uses the same character, is at least as long, and has nothing else on the line.
      const fecha =
        marca !== null &&
        marca[1][0] === cerca.char &&
        marca[1].length >= cerca.tamanho &&
        texto.slice(marca[0].length).trim() === "";
      if (fecha) cerca = undefined;
      continue;
    }

    if (marca !== null) {
      cerca = { char: marca[1][0], tamanho: marca[1].length };
      continue;
    }

    const m = CABECALHO_MD.exec(texto);
    if (m) saida.push({ nivel: m[1].length, titulo: m[2].trim(), linha: i + 1 });
  }
  return saida;
}

function cabecalhosDocx(paragrafos: Paragrafo[]): Cabecalho[] {
  const saida: Cabecalho[] = [];
  for (const q of paragrafos) {
    if (q.nivel !== undefined) saida.push({ nivel: q.nivel, titulo: q.texto, linha: q.indice });
  }
  return saida;
}

function lerIntervalo(linhas: string[], total: number, base: SearchMatch, p: LeituraParams): Saida {
  const r = intervalo(total, p.linha_inicio, p.linha_fim);
  if (r === undefined) return { dicas: [`Intervalo fora do arquivo (${total} linhas)`] };
  return {
    achado: {
      ...base,
      linha: r.inicio,
      linha_inicio: r.inicio,
      linha_fim: r.fim,
      conteudo: linhas.slice(r.inicio - 1, r.fim).join("\n"),
    },
  };
}

// Code: a symbol block, a line range, or the symbol list when nothing is asked.
function lerCodigo(linhas: string[], ext: string, base: SearchMatch, p: LeituraParams): Saida {
  const texto = linhas.join("\n");
  if (p.secao !== undefined) {
    const bloco = extractSymbolBlock(texto, ext, p.secao);
    if (bloco === undefined) {
      const nomes = listSymbols(texto, ext).map((s) => s.nome);
      return { dicas: [`Símbolo '${p.secao}' não encontrado. Disponíveis: ${nomes.join(", ")}`] };
    }
    return {
      achado: {
        ...base,
        secao_titulo: bloco.nome,
        secao_linha: bloco.linha_inicio,
        linha_inicio: bloco.linha_inicio,
        linha_fim: bloco.linha_fim,
        conteudo: bloco.conteudo,
      },
    };
  }
  if (temIntervalo(p)) return lerIntervalo(linhas, contarLinhas(linhas), base, p);

  const simbolos = listSymbols(texto, ext).map((s) => ({ nome: s.nome, tipo: s.tipo, linha: s.linha }));
  return {
    achado: { ...base, simbolos_disponiveis: simbolos },
    dicas: ["Use 'secao' ou linha_inicio/linha_fim para ler o trecho"],
  };
}

// Markdown section: from the first heading containing `secao` to the next heading of the same or higher level.
function lerSecaoMarkdown(linhas: string[], secao: string, base: SearchMatch): Saida {
  const cabecalhos = cabecalhosMd(linhas);
  const achado = escolherCabecalho(cabecalhos, (c) => c.titulo, secao);
  if (achado === undefined) {
    const titulos = cabecalhos.map((c) => c.titulo).join(", ") || "nenhum";
    return { dicas: [`Seção '${secao}' não encontrada. Cabeçalhos: ${titulos}`] };
  }

  const proximo = cabecalhos.find((c) => c.linha > achado.linha && c.nivel <= achado.nivel);
  let fim = proximo !== undefined ? proximo.linha - 1 : linhas.length;
  const inicio = achado.linha - 1;
  while (fim > inicio + 1 && linhas[fim - 1].trim() === "") fim--;

  return {
    achado: {
      ...base,
      secao_titulo: achado.titulo,
      secao_linha: achado.linha,
      linha_inicio: achado.linha,
      linha_fim: fim,
      conteudo: linhas.slice(inicio, fim).join("\n"),
    },
  };
}

// Plain text, markdown notes and csv/tsv: line ranges, the heading list for markdown, or the first 200 lines.
function lerTexto(linhas: string[], ext: string, base: SearchMatch, p: LeituraParams): Saida {
  if (p.secao !== undefined) {
    if (ext === "md") return lerSecaoMarkdown(linhas, p.secao, base);
    return { dicas: ["Seção só existe em código, markdown e docx; use linha_inicio/linha_fim"] };
  }
  const total = contarLinhas(linhas);
  if (temIntervalo(p)) return lerIntervalo(linhas, total, base, p);
  if (ext === "md") return { achado: { ...base, cabecalhos_disponiveis: cabecalhosMd(linhas) } };

  const fim = Math.min(total, LINHAS_PADRAO);
  return {
    achado: { ...base, linha: 1, linha_inicio: 1, linha_fim: fim, conteudo: linhas.slice(0, fim).join("\n") },
    ...(total > LINHAS_PADRAO ? { dicas: [`Arquivo com ${total} linhas; use linha_inicio/linha_fim`] } : {}),
  };
}

// Word document: a section by heading, a paragraph index range, or the heading list.
function lerDocx(paragrafos: Paragrafo[], base: SearchMatch, p: LeituraParams): Saida {
  if (p.secao !== undefined) {
    const candidatos = paragrafos.filter((q) => q.nivel !== undefined);
    const escolhido = escolherCabecalho(candidatos, (q) => q.texto, p.secao);
    const idx = escolhido ? paragrafos.indexOf(escolhido) : -1;
    if (idx < 0) {
      const titulos = cabecalhosDocx(paragrafos).map((c) => c.titulo).join(", ") || "nenhum";
      return { dicas: [`Seção '${p.secao}' não encontrada. Cabeçalhos: ${titulos}`] };
    }
    const cabeca = paragrafos[idx];
    const nivel = cabeca.nivel ?? 0;
    let fimIdx = paragrafos.length;
    for (let j = idx + 1; j < paragrafos.length; j++) {
      const n = paragrafos[j].nivel;
      if (n !== undefined && n <= nivel) {
        fimIdx = j;
        break;
      }
    }
    const seguintes = paragrafos.slice(idx + 1, fimIdx);
    const ultimo = seguintes.length > 0 ? seguintes[seguintes.length - 1].indice : cabeca.indice;
    return {
      achado: {
        ...base,
        secao_titulo: cabeca.texto,
        secao_linha: cabeca.indice,
        linha_inicio: cabeca.indice,
        linha_fim: ultimo,
        conteudo: seguintes.map((q) => q.texto).join("\n"),
      },
    };
  }

  if (temIntervalo(p)) {
    const ultimo = paragrafos.length > 0 ? paragrafos[paragrafos.length - 1].indice : 0;
    const r = intervalo(ultimo, p.linha_inicio, p.linha_fim);
    if (r === undefined) return { dicas: [`Intervalo fora do documento (${ultimo} parágrafos)`] };
    const escolhidos = paragrafos.filter((q) => q.indice >= r.inicio && q.indice <= r.fim);
    return {
      achado: {
        ...base,
        linha: r.inicio,
        linha_inicio: r.inicio,
        linha_fim: r.fim,
        conteudo: escolhidos.map((q) => q.texto).join("\n"),
      },
      ...(p.linha_fim !== undefined && p.linha_fim > ultimo
        ? { dicas: [`Intervalo limitado ao último parágrafo com texto (${ultimo}).`] }
        : {}),
    };
  }

  return { achado: { ...base, cabecalhos_disponiveis: cabecalhosDocx(paragrafos) } };
}

// PDF: one page by default, or a page range joined with a "--- página N ---" separator.
function lerPdf(paginas: string[], base: SearchMatch, p: LeituraParams): Saida {
  if (p.secao !== undefined) return { dicas: ["PDF não tem seções; use pagina_inicio/pagina_fim"] };
  const total = paginas.length;

  if (p.pagina_inicio === undefined && p.pagina_fim === undefined) {
    return {
      achado: { ...base, pagina: 1, conteudo: paginas[0] ?? "" },
      dicas: [`PDF com ${total} páginas; use pagina_inicio/pagina_fim`],
    };
  }

  const ini = p.pagina_inicio ?? p.pagina_fim ?? 1;
  const fim = p.pagina_fim ?? p.pagina_inicio ?? 1;
  if (ini < 1 || ini > total || fim < ini) {
    return { dicas: [`Página fora do intervalo. O PDF tem ${total} páginas`] };
  }

  const ultima = Math.min(fim, total);
  let conteudo = paginas[ini - 1];
  for (let n = ini + 1; n <= ultima; n++) {
    conteudo += `\n\n--- página ${n} ---\n\n${paginas[n - 1]}`;
  }
  return { achado: { ...base, pagina: ini, conteudo } };
}

// Reads a section or a range of one file. Relative paths are resolved from the vault base path.
export async function getSectionUniversal(p: LeituraParams, ctx: UniversalContext): Promise<SearchResultPayload> {
  const inicio = Date.now();
  const pedido: LeituraParams = { ...p, secao: p.secao?.trim() || undefined };
  const consulta: Record<string, unknown> = {
    acao: "obter_secao",
    arquivo: p.arquivo,
    secao: pedido.secao,
    linha_inicio: p.linha_inicio,
    linha_fim: p.linha_fim,
    pagina_inicio: p.pagina_inicio,
    pagina_fim: p.pagina_fim,
    modo: "universal",
  };
  const vazio = (dicas: string[]): SearchResultPayload => ({
    consulta,
    total: 0,
    resultados: [],
    dicas,
    tempo_ms: Date.now() - inicio,
  });

  const arquivo = p.arquivo.trim();
  const absoluto = isAbsolutePath(arquivo);
  if (!absoluto && ctx.basePath === "") return vazio(["Caminho do cofre indisponível"]);

  const abs = absoluto ? arquivo : path.join(ctx.basePath, arquivo);
  // Vault files are compared by their vault-relative path; computer paths are never excluded.
  const caminhoDe = (alvo: string): string =>
    ctx.basePath === "" ? alvo.replace(/\\/g, "/") : displayPath(alvo, ctx.basePath);
  const naoEncontrado = vazio([`Arquivo não encontrado: ${arquivo}`]);
  if (isExcluded(caminhoDe(abs), ctx.excluidas)) return naoEncontrado;
  if (ehCaminhoBloqueado(abs) || ehCaminhoBloqueado(caminhoDe(abs))) {
    return vazio(["Acesso bloqueado: arquivo de credenciais ou de configuração sensível"]);
  }

  const info = await stat(abs).catch(() => undefined);
  if (info?.isDirectory()) {
    return vazio([
      "O caminho aponta para uma pasta; informe um arquivo (use list_files para listar o conteúdo da pasta).",
    ]);
  }
  if (info === undefined || !info.isFile()) return naoEncontrado;

  const nome = path.basename(abs);
  const ext = nome.includes(".") ? nome.slice(nome.lastIndexOf(".") + 1).toLowerCase() : "";
  const tipo = tipoDoArquivo(ext);
  if (tipo === "outro") return vazio(["Tipo de arquivo não suportado"]);
  if (ext === "xlsx") return vazio(["Para planilhas use a tool read_table"]);

  const conteudo = await carregarConteudo(
    { abs, extensao: ext, tamanho: info.size, mtime: info.mtimeMs },
    ctx.conteudo,
  );
  if (conteudo === undefined) return vazio(["Tipo de arquivo não suportado"]);

  const base: SearchMatch = {
    tipo,
    caminho: caminhoDe(abs),
    nome,
    extensao: ext,
  };

  let saida: Saida;
  if (ext === "pdf" && conteudo.paginas !== undefined) {
    saida = lerPdf(conteudo.paginas, base, pedido);
  } else if (conteudo.paragrafos !== undefined) {
    saida = lerDocx(conteudo.paragrafos, base, pedido);
  } else if (conteudo.linhas !== undefined) {
    const linhas = conteudo.linhas;
    saida = tipo === "codigo" ? lerCodigo(linhas, ext, base, pedido) : lerTexto(linhas, ext, base, pedido);
  } else {
    saida = { dicas: ["Tipo de arquivo não suportado"] };
  }

  if (saida.achado === undefined) return vazio(saida.dicas ?? []);
  return {
    consulta,
    total: 1,
    resultados: [redigirMatch(saida.achado)],
    ...(saida.dicas !== undefined ? { dicas: saida.dicas } : {}),
    tempo_ms: Date.now() - inicio,
  };
}
