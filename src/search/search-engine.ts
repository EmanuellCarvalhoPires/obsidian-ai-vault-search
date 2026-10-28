// Fast memory engine that reads directly from Obsidian's app.metadataCache and vault
import { TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { isExcluded, normalizeFolders } from "./exclusion";
import type { LerNotaParams, SearchMatch, SearchQueryParams, SearchResultPayload } from "./types";
import { IndiceBm25, tokenizar } from "./indice-bm25";
import type { TermoConsulta } from "./indice-bm25";
import { filtrarBaixaPontuacao, pontuarNomeDetalhado } from "./universal-find";
import { escolherCabecalho } from "./cabecalho";
import { maisParecidos } from "./similaridade";

export const SINONIMOS: Set<string>[] = [
  new Set(["acesso", "access", "credencial", "token", "auth"]),
  new Set(["instancia", "instance", "site", "dominio"]),
  new Set(["ferramenta", "tool", "funcao", "skill"]),
  new Set(["requisicao", "request", "chamada", "endpoint"]),
  new Set(["modelo", "template", "molde", "padrao"]),
  new Set(["empresa", "company", "cliente"]),
  new Set(["projeto", "project", "epico"]),
  new Set(["campo", "field", "customfield"]),
  new Set(["fila", "queue", "jsw", "jsm"]),
  new Set(["deploy", "pipeline", "release", "publicacao"]),
  new Set(["defeito", "bug", "problema", "issue", "falha"]),
  new Set(["automacao", "automation", "fluxo", "workflow"]),
  new Set(["validar", "auditar", "conferir", "checar", "verificar"]),
];

// Limite do texto de seção que a busca com ler devolve.
const LER_MAX_CARACTERES = 4000;

// Tamanho dos trechos: curto por padrão, longo só com detalhe.
const TRECHO_PADRAO = 120;
const TRECHO_DETALHE = 200;
const SECAO_TRECHO_DETALHE = 300;

/** Só linhas de links (wikilinks, links Markdown, pontuação e números) não servem de trecho. */
export function linhaSoLinks(linha: string): boolean {
  const semWikilinks = linha.replace(/\[\[[^\]]*\]\]/g, "");
  const semLinks = semWikilinks.replace(/\[[^\]]*\]\([^)]*\)/g, "");
  if (semLinks === linha) return false;
  return semLinks.replace(/[\s\-*+>|,;:.\d]/g, "") === "";
}

function norm(texto: unknown): string {
  if (!texto) return "";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getVariantes(termo: string): Set<string> {
  const t = norm(termo);
  for (const grupo of SINONIMOS) {
    if (grupo.has(t)) return grupo;
  }
  return new Set([t]);
}

// Trecho e seção de uma nota para a página devolvida.
interface TrechoNota {
  linha?: number;
  trecho?: string;
  secaoTitulo?: string;
  secaoLinha?: number;
  secaoTrecho?: string;
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Exato: a variante precisa ser palavra inteira (limites a-z0-9), não parte de outra.
function casaLinha(linhaNormalizada: string, termos: TermoConsulta[], exato: boolean): boolean {
  for (const termo of termos) {
    for (const variante of termo.variantes) {
      if (!exato) {
        if (linhaNormalizada.includes(variante)) return true;
      } else if (new RegExp(`(^|[^a-z0-9])${escaparRegExp(variante)}([^a-z0-9]|$)`).test(linhaNormalizada)) {
        return true;
      }
    }
  }
  return false;
}

// Quantos termos distintos a linha casa (cada termo conta no máximo 1).
function contarTermos(linhaNormalizada: string, termos: TermoConsulta[], exato: boolean): number {
  let total = 0;
  for (const termo of termos) {
    if (casaLinha(linhaNormalizada, [termo], exato)) total++;
  }
  return total;
}

function isIgnored(path: string): boolean {
  return (
    path.startsWith(".obsidian") ||
    path.startsWith(".trash") ||
    path.startsWith(".git") ||
    path.startsWith(".claude") ||
    path.startsWith("scratch")
  );
}

export class VaultSearchEngine {
  private excludedFolders: string[] = [];
  private readonly indice = new IndiceBm25();
  // Marca (mtime e tamanho) de cada nota já lida pelo índice.
  private readonly indexado = new Map<string, { mtime: number; size: number }>();

  constructor(private readonly app: App) {}

  /** Vault-relative folders left out of every listing, search and section read. */
  setExcludedFolders(folders: string[]): void {
    this.excludedFolders = normalizeFolders(folders);
  }

  getExcludedFolders(): string[] {
    return [...this.excludedFolders];
  }

  private ignored(path: string): boolean {
    return isIgnored(path) || isExcluded(path, this.excludedFolders);
  }

  /** Markdown notes the search can see (same set the "buscar" action reads). */
  getIndexedNotes(): TFile[] {
    return this.getMarkdownFiles();
  }

  private getMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => !this.ignored(f.path));
  }

  // Pasta relativa ao cofre, sem diferenciar maiúsculas; vazia ou "." não filtra.
  private filtrarPorPasta(files: TFile[], pasta: string | undefined): TFile[] {
    const alvo = (pasta ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
    if (alvo === "" || alvo === ".") return files;
    return files.filter((f) => {
      const caminho = f.path.toLowerCase();
      return caminho === alvo || caminho.startsWith(alvo + "/");
    });
  }

  // Cada condição é "chave=valor" (separa no primeiro "="); sem "=" vale só a chave. Todas precisam valer.
  private filtrarPorProp(files: TFile[], prop: string | string[]): TFile[] {
    const condicoes = (Array.isArray(prop) ? prop : [prop])
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const igual = s.indexOf("=");
        if (igual < 0) return { chave: norm(s), valor: undefined as string | undefined };
        return { chave: norm(s.slice(0, igual)), valor: norm(s.slice(igual + 1)) };
      });

    return files.filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) return false;
      return condicoes.every(({ chave, valor }) =>
        Object.entries(fm).some(([k, v]) => {
          if (norm(k) !== chave) return false;
          if (valor === undefined) return true;
          // Lista no frontmatter: basta um elemento casar.
          const valores = Array.isArray(v) ? v : [v];
          return valores.some((x) => norm(String(x)).includes(valor));
        }),
      );
    });
  }

  // Dicas de busca de notas sem resultado; nada quando há resultados (quem chama decide).
  private dicasSemResultado(params: SearchQueryParams, universo: TFile[], pediuTermos: boolean): string[] {
    const dicas: string[] = [];

    if (params.tag) {
      const tagSemHash = params.tag.replace(/^#/, "").replace(/\/$/, "");
      const tags = Array.from(new Set(universo.flatMap((f) => this.extractTags(f))));
      const parecidas = maisParecidos(tagSemHash, tags);
      dicas.push(
        `Nenhuma nota com a tag '${params.tag}'.` +
          (parecidas.length > 0 ? ` Tags parecidas: ${parecidas.join(", ")}.` : ""),
      );
    }

    if (params.titulo) {
      const parecidos = maisParecidos(params.titulo, universo.map((f) => f.basename));
      dicas.push(
        `Nenhuma nota com '${params.titulo}' no título.` +
          (parecidos.length > 0 ? ` Nomes parecidos: ${parecidos.join(", ")}.` : ""),
      );
    }

    if (pediuTermos) {
      // Exato ignora sinônimos, então a dica sugere tirar exato; sem sinônimos, sugere ligá-los.
      const complemento = params.exato
        ? " ou tire exato"
        : params.sinonimos
          ? ""
          : ", ou use sinonimos: true";
      dicas.push(`Nenhuma nota casou com os termos. Tente menos termos${complemento}.`);
    }

    return dicas;
  }

  private extractUp(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || !frontmatter.up) return [];
    const val = frontmatter.up;
    const items = Array.isArray(val) ? val : [val];
    const upNotes: string[] = [];
    for (const item of items) {
      const matches = String(item).matchAll(/\[\[([^\]|#^]+)/g);
      for (const m of matches) {
        if (m[1]) upNotes.push(m[1].trim());
      }
    }
    return upNotes;
  }

  private extractTags(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = new Set<string>();
    if (cache?.frontmatter?.tags) {
      const fTags = Array.isArray(cache.frontmatter.tags)
        ? cache.frontmatter.tags
        : [cache.frontmatter.tags];
      for (const t of fTags) {
        if (t) tags.add(String(t).replace(/^#/, "").replace(/\/$/, ""));
      }
    }
    if (cache?.tags) {
      for (const t of cache.tags) {
        if (t.tag) tags.add(t.tag.replace(/^#/, "").replace(/\/$/, ""));
      }
    }
    return Array.from(tags);
  }

  private extractOutlinks(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.links) return [];
    return Array.from(new Set(cache.links.map((l) => l.link.replace(/[#^].*$/, "").trim())));
  }

  /** Deixa o índice igual às notas visíveis; só relê as que mudaram de mtime ou tamanho. */
  private async sincronizarIndice(files: TFile[]): Promise<void> {
    const visiveis = new Set(files.map((f) => f.path));
    for (const path of [...this.indexado.keys()]) {
      if (visiveis.has(path)) continue;
      this.indice.remover(path);
      this.indexado.delete(path);
    }

    for (const file of files) {
      const marca = this.indexado.get(file.path);
      if (marca && marca.mtime === file.stat.mtime && marca.size === file.stat.size) continue;

      const corpo = await this.app.vault.cachedRead(file);
      this.indice.atualizar(file.path, {
        titulo: file.basename,
        tags: this.extractTags(file).join(" "),
        up: this.extractUp(file).join(" "),
        corpo,
      });
      this.indexado.set(file.path, { mtime: file.stat.mtime, size: file.stat.size });
    }
  }

  private montarTermosConsulta(termos: string[], opcoes: { sinonimos: boolean; exato: boolean }): TermoConsulta[] {
    const consulta: TermoConsulta[] = [];
    for (const termo of termos) {
      for (const palavra of tokenizar(String(termo))) {
        const variantes = opcoes.sinonimos && !opcoes.exato ? [...getVariantes(palavra)] : [palavra];
        consulta.push({ variantes });
      }
    }
    return consulta;
  }

  /**
   * Linha que casa mais termos (empate: a primeira) e a seção dela quando pedida.
   * Só roda para a página devolvida.
   */
  private async localizarTrecho(
    file: TFile,
    termos: TermoConsulta[],
    opcoes: { exato: boolean; secao: boolean; detalhe: boolean },
  ): Promise<TrechoNota> {
    const linhas = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
    const tamanhoTrecho = opcoes.detalhe ? TRECHO_DETALHE : TRECHO_PADRAO;
    const achado: TrechoNota = {};

    let melhor = 0;
    for (let i = 0; i < linhas.length; i++) {
      // Linha só de links repete a nota e não ajuda a ler o trecho.
      if (linhaSoLinks(linhas[i])) continue;
      const contagem = contarTermos(norm(linhas[i]), termos, opcoes.exato);
      if (contagem > melhor) {
        melhor = contagem;
        achado.linha = i + 1;
        achado.trecho = linhas[i].trim().slice(0, tamanhoTrecho);
      }
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (opcoes.secao && cache?.headings) {
      for (const h of cache.headings) {
        if (h.position.start.line <= (achado.linha || 1)) {
          achado.secaoTitulo = h.heading;
          achado.secaoLinha = h.position.start.line + 1;
          if (opcoes.detalhe) {
            const fimLinha = Math.min(h.position.start.line + 8, linhas.length);
            achado.secaoTrecho = linhas
              .slice(h.position.start.line, fimLinha)
              .join(" ")
              .trim()
              .slice(0, SECAO_TRECHO_DETALHE);
          }
        }
      }
    }

    // A seção que só repete o nome da nota não acrescenta nada.
    if (achado.secaoTitulo !== undefined && norm(achado.secaoTitulo) === norm(file.basename)) {
      achado.secaoTitulo = undefined;
      achado.secaoLinha = undefined;
      achado.secaoTrecho = undefined;
    }
    return achado;
  }

  /** Texto da seção que contém a linha; sem cabeçalho antes dela, o trecho inicial da nota. */
  private async lerSecaoDoResultado(
    file: TFile,
    linha: number | undefined,
  ): Promise<{ titulo?: string; linhaInicio: number; conteudo: string }> {
    const linhas = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    const alvo = Math.max(0, (linha ?? 1) - 1);

    let idx = -1;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].position.start.line <= alvo) idx = i;
    }

    let inicio: number;
    let fim: number;
    let titulo: string | undefined;
    if (idx >= 0) {
      const atual = headings[idx];
      inicio = atual.position.start.line;
      titulo = atual.heading;
      const proximo = headings.slice(idx + 1).find((h) => h.level <= atual.level);
      fim = proximo !== undefined ? proximo.position.start.line : linhas.length;
    } else {
      inicio = 0;
      fim = headings.length > 0 ? headings[0].position.start.line : linhas.length;
    }

    const texto = linhas.slice(inicio, fim).join("\n").trim();
    const conteudo =
      texto.length > LER_MAX_CARACTERES
        ? `${texto.slice(0, LER_MAX_CARACTERES)}\n[... truncado; use get_section para o restante]`
        : texto;
    return { titulo, linhaInicio: inicio + 1, conteudo };
  }

  /** Chamado quando o Obsidian altera a nota: a próxima busca a relê. */
  invalidarNota(path: string): void {
    this.indexado.delete(path);
  }

  removerNota(path: string): void {
    this.indice.remover(path);
    this.indexado.delete(path);
  }

  /** O novo caminho entra no índice na próxima busca. */
  renomearNota(antigo: string, _novo: string): void {
    this.removerNota(antigo);
  }

  async aquecerIndice(): Promise<void> {
    await this.sincronizarIndice(this.getMarkdownFiles());
  }

  async findNotes(params: {
    query?: string;
    padrao?: string;
    pasta?: string;
    limite?: number;
    offset?: number;
    tag?: string;
    extensao?: string;
  }): Promise<SearchResultPayload> {
    const startTime = Date.now();
    const rawQuery = (params.query || params.padrao || "").trim();
    const pasta = (params.pasta || "").trim().replace(/\/$/, "");
    const limite = params.limite && params.limite > 0 ? params.limite : 10;
    const offset = Math.max(0, Math.floor(params.offset ?? 0));
    const ext = (params.extensao ?? "").trim().toLowerCase() || "md";

    let files =
      ext === "md"
        ? this.getMarkdownFiles()
        : this.app.vault.getFiles().filter((f) => !this.ignored(f.path) && (ext === "*" || f.extension.toLowerCase() === ext));
    // Antes dos filtros de pasta e tag: as dicas de resultado vazio olham o cofre todo.
    const universo = files;

    files = this.filtrarPorPasta(files, params.pasta);

    if (params.tag) {
      const tagAlvo = norm(params.tag.replace(/^#/, "").replace(/\/$/, ""));
      files = files.filter((f) => {
        const tags = this.extractTags(f).map((t) => norm(t));
        return tags.some((t) => t === tagAlvo || t.startsWith(tagAlvo + "/"));
      });
    }

    const normQuery = norm(rawQuery);
    const tokens = normQuery
      .split(/\s+/)
      .filter((t) => t.length > 0);

    interface ScoredMatch {
      file: TFile;
      pontos: number;
      casados: number;
      tokens: number;
    }

    let scored: ScoredMatch[] = [];

    if (tokens.length === 0) {
      scored = files.map((f) => ({ file: f, pontos: 0, casados: 0, tokens: 0 }));
      scored.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
    } else {
      // Same score and low-score filter as the universal find.
      for (const file of files) {
        const d = pontuarNomeDetalhado(file.basename, file.path, rawQuery);
        if (d.pontos === 0) continue;
        scored.push({ file, pontos: d.pontos, casados: d.casados, tokens: d.tokens });
      }

      scored = filtrarBaixaPontuacao(scored);
      scored.sort((a, b) => {
        if (b.pontos !== a.pontos) return b.pontos - a.pontos;
        return b.file.stat.mtime - a.file.stat.mtime;
      });
    }

    const total = scored.length;
    const slice = scored.slice(offset, offset + limite);
    const restantes = Math.max(0, total - offset - slice.length);

    const resultados: SearchMatch[] = slice.map(({ file, pontos }) => ({
      tipo: "nota",
      caminho: file.path,
      nome: file.basename,
      tags: this.extractTags(file),
      up: this.extractUp(file),
      pontos: tokens.length > 0 ? pontos : undefined,
      modificada: new Date(file.stat.mtime).toLocaleString("pt-BR"),
    }));

    const dicas: string[] = [];
    if (total === 0) {
      if (params.tag) dicas.push(...this.dicasSemResultado({ acao: "buscar_rapida", tag: params.tag }, universo, false));
      if (rawQuery !== "") {
        const parecidos = maisParecidos(rawQuery, universo.map((f) => f.basename));
        dicas.push(
          `Nenhum arquivo com '${rawQuery}' no nome ou no caminho. Tente menos palavras.` +
            (parecidos.length > 0 ? ` Nomes parecidos: ${parecidos.join(", ")}.` : ""),
        );
      }
    }

    return {
      consulta: {
        acao: "buscar_rapida",
        query: rawQuery,
        pasta: pasta || "/",
        limite,
      },
      total,
      tempo_ms: Date.now() - startTime,
      resultados,
      ...(restantes > 0 ? { restantes } : {}),
      ...(dicas.length > 0 ? { dicas } : {}),
    };
  }

  /** Acha a nota pelo caminho, depois pelo nome, depois por parte do nome; explica a escolha. */
  private resolverNota(files: TFile[], alvo: string): { file?: TFile; dicas: string[] } {
    const limpo = alvo.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
    const chave = norm(limpo);
    if (chave === "") return { dicas: [`Nota não encontrada: ${alvo}`] };

    const semMd = (caminho: string) => caminho.replace(/\.md$/i, "");

    const porCaminho = files.find((f) => norm(semMd(f.path)) === chave);
    if (porCaminho) return { file: porCaminho, dicas: [] };

    const porNome = files.filter((f) => norm(f.basename) === chave);
    if (porNome.length === 1) return { file: porNome[0], dicas: [] };
    if (porNome.length > 1) {
      const ordenadas = [...porNome].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
      const escolhida = ordenadas[0];
      const caminhos = ordenadas.slice(0, 5).map((f) => f.path).join(", ");
      return {
        file: escolhida,
        dicas: [
          `Havia ${porNome.length} notas chamadas '${alvo}': ${caminhos}. Usada: ${escolhida.path}. Informe o caminho para escolher outra.`,
        ],
      };
    }

    const parciais = files.filter((f) => norm(f.basename).includes(chave));
    if (parciais.length === 1) {
      return {
        file: parciais[0],
        dicas: [`Nota resolvida por correspondência parcial: ${parciais[0].path}`],
      };
    }
    if (parciais.length > 1) {
      const caminhos = parciais.slice(0, 5).map((f) => f.path).join(", ");
      return { dicas: [`Nota ambígua '${alvo}'. Candidatas: ${caminhos}`] };
    }

    const dicas = [`Nota não encontrada: ${alvo}`];
    const parecidas = maisParecidos(alvo, files.map((f) => f.basename));
    if (parecidas.length > 0) dicas.push(`Parecidas: ${parecidas.join(", ")}`);
    return { dicas };
  }

  /** Lê uma nota numa chamada: frontmatter escolhido, esboço, links de saída e início do corpo. */
  async lerNota(params: LerNotaParams): Promise<SearchResultPayload> {
    const startTime = Date.now();
    const resolucao = this.resolverNota(this.getMarkdownFiles(), params.nota);
    const file = resolucao.file;

    if (!file) {
      return {
        consulta: { acao: "ler_nota", nota: params.nota },
        total: 0,
        tempo_ms: Date.now() - startTime,
        resultados: [],
        dicas: resolucao.dicas,
      };
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const resultado: SearchMatch = { tipo: "nota", caminho: file.path, nome: file.basename };

    // Sem `frontmatter` ou com "*" vem tudo; lista vazia não vem nada.
    const pedidas = params.frontmatter;
    if (cache?.frontmatter && (pedidas === undefined || pedidas.length > 0)) {
      const todas = pedidas === undefined || pedidas.includes("*");
      const nomes = new Set((pedidas ?? []).map((p) => norm(p)));
      const escolhidas: Record<string, unknown> = {};
      for (const [chave, valor] of Object.entries(cache.frontmatter)) {
        if (chave === "position") continue;
        if (todas || nomes.has(norm(chave))) escolhidas[chave] = valor;
      }
      resultado.frontmatter = escolhidas;
    }

    if (params.outline !== false) {
      resultado.outline = (cache?.headings ?? []).map((h) => ({
        nivel: h.level,
        titulo: h.heading,
        linha: h.position.start.line + 1,
      }));
    }

    if (params.outlinks !== false) {
      resultado.outlinks = this.extractOutlinks(file);
    }

    // Só lê o corpo quando ele é pedido.
    if (typeof params.corpo === "number" && params.corpo > 0) {
      const linhas = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
      let inicio = 0;
      if (linhas[0]?.trim() === "---") {
        const fecha = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
        if (fecha > 0) inicio = fecha + 1;
      }
      const corpo = linhas.slice(inicio).join("\n").trim();
      if (corpo.length > params.corpo) {
        resultado.corpo = corpo.slice(0, params.corpo);
        resultado.corpo_truncado = true;
      } else {
        resultado.corpo = corpo;
      }
    }

    return {
      consulta: { acao: "ler_nota", nota: file.basename },
      total: 1,
      tempo_ms: Date.now() - startTime,
      resultados: [resultado],
      ...(resolucao.dicas.length > 0 ? { dicas: resolucao.dicas } : {}),
    };
  }

  // Pasta pedida sem diferenciar maiúsculas nem barras; se não existir, sugere as parecidas.
  private resolverPasta(pasta: string): { real?: string; sugestoes: string[]; excluida?: boolean } {
    const alvo = pasta.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (alvo === "") return { real: "", sugestoes: [] };

    const todas = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f instanceof TFolder && f.path !== "/" && f.path !== "")
      .map((f) => f.path);
    const pastas = todas.filter((p) => !this.ignored(p));

    const visivel = pastas.find((p) => p === alvo) ?? pastas.find((p) => p.toLowerCase() === alvo.toLowerCase());
    if (visivel !== undefined) return { real: visivel, sugestoes: [] };
    // Pasta que existe mas está excluída nas configurações: diz isso, em vez de "não encontrada".
    if (todas.some((p) => p.toLowerCase() === alvo.toLowerCase())) return { sugestoes: [], excluida: true };
    return { sugestoes: maisParecidos(alvo, pastas, 5) };
  }

  private dicasPastaNaoEncontrada(pasta: string, sugestoes: string[], excluida = false): string[] {
    if (excluida) return [`Pasta excluída nas configurações do AI Vault Search: ${pasta}`];
    return [
      `Pasta não encontrada: ${pasta}`,
      ...(sugestoes.length > 0 ? [`Parecidas: ${sugestoes.join(", ")}`] : []),
    ];
  }

  /** Tags das notas visíveis com quantas notas usam cada uma; mais usadas primeiro. */
  listarTags(params: { prefixo?: string; limite?: number }): {
    total: number;
    restantes?: number;
    tags: { tag: string; contagem: number }[];
  } {
    const contagens = new Map<string, number>();
    for (const file of this.getMarkdownFiles()) {
      for (const tag of this.extractTags(file)) {
        contagens.set(tag, (contagens.get(tag) ?? 0) + 1);
      }
    }

    const prefixo = norm((params.prefixo ?? "").replace(/^#/, ""));
    const lista = [...contagens.entries()]
      .filter(([tag]) => norm(tag).startsWith(prefixo))
      .map(([tag, contagem]) => ({ tag, contagem }))
      .sort((a, b) => b.contagem - a.contagem || a.tag.localeCompare(b.tag));

    const total = lista.length;
    const limite = params.limite ?? 50;
    const tags = limite > 0 ? lista.slice(0, limite) : lista;
    const restantes = total - tags.length;
    return { total, ...(restantes > 0 ? { restantes } : {}), tags };
  }

  /** Notas visíveis mais recentemente modificadas, com filtro opcional de pasta e tag. */
  notasRecentes(params: { limite?: number; pasta?: string; tag?: string }): SearchResultPayload {
    const startTime = Date.now();
    let files = this.filtrarPorPasta(this.getMarkdownFiles(), params.pasta);

    if (params.tag) {
      const tagAlvo = norm(params.tag.replace(/^#/, "").replace(/\/$/, ""));
      files = files.filter((f) => {
        const tags = this.extractTags(f).map((t) => norm(t));
        return tags.some((t) => t === tagAlvo || t.startsWith(tagAlvo + "/"));
      });
    }

    const ordenadas = [...files].sort((a, b) => b.stat.mtime - a.stat.mtime);
    const limite = params.limite && params.limite > 0 ? params.limite : 10;
    const resultados: SearchMatch[] = ordenadas.slice(0, limite).map((f) => ({
      tipo: "nota",
      caminho: f.path,
      nome: f.basename,
      modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
    }));

    return {
      consulta: { acao: "recentes" },
      total: ordenadas.length,
      tempo_ms: Date.now() - startTime,
      resultados,
    };
  }

  async search(params: SearchQueryParams): Promise<SearchResultPayload> {
    const startTime = Date.now();
    const acao = params.acao || "buscar";

    if (acao === "buscar_rapida") {
      return this.findNotes(params);
    }

    // -------------------------------------------------------------
    // AÇÃO 1: Listar Pastas
    // -------------------------------------------------------------
    if (acao === "listar_pastas") {
      const pastaBase = params.pasta || "";
      const recursivo = params.recursivo === true;
      const resolvida = this.resolverPasta(pastaBase);
      if (pastaBase && resolvida.real === undefined) {
        return {
          consulta: { acao, pasta: pastaBase, recursivo },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: this.dicasPastaNaoEncontrada(pastaBase, resolvida.sugestoes),
        };
      }
      const targetFolder = this.app.vault.getAbstractFileByPath(resolvida.real || "/");

      const folders: SearchMatch[] = [];

      const collect = (item: TAbstractFile) => {
        if (this.ignored(item.path)) return;
        if (item instanceof TFolder) {
          let filesCount = 0;
          let subfoldersCount = 0;
          for (const child of item.children) {
            if (this.ignored(child.path)) continue;
            if (child instanceof TFile) filesCount++;
            else if (child instanceof TFolder) subfoldersCount++;
          }
          folders.push({
            tipo: "pasta",
            caminho: item.path,
            nome: item.name || "raiz",
            total_arquivos: filesCount,
            total_subpastas: subfoldersCount,
          });
          if (recursivo) {
            for (const child of item.children) {
              if (child instanceof TFolder) collect(child);
            }
          }
        }
      };

      if (targetFolder instanceof TFolder) {
        if (recursivo) {
          collect(targetFolder);
        } else {
          for (const child of targetFolder.children) {
            if (child instanceof TFolder && !this.ignored(child.path)) {
              let filesCount = 0;
              let subfoldersCount = 0;
              for (const sub of child.children) {
                if (this.ignored(sub.path)) continue;
                if (sub instanceof TFile) filesCount++;
                else if (sub instanceof TFolder) subfoldersCount++;
              }
              folders.push({
                tipo: "pasta",
                caminho: child.path,
                nome: child.name,
                total_arquivos: filesCount,
                total_subpastas: subfoldersCount,
              });
            }
          }
        }
      }

      folders.sort((a, b) => a.caminho.localeCompare(b.caminho));
      return {
        consulta: { acao, pasta: pastaBase || "/", recursivo },
        total: folders.length,
        tempo_ms: Date.now() - startTime,
        resultados: folders,
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 2: Listar Arquivos
    // -------------------------------------------------------------
    if (acao === "listar_arquivos") {
      const pasta = params.pasta || "";
      const ext = (params.extensao ?? "").trim().toLowerCase() || "md";
      const recursivo = params.recursivo === true;
      const limite = params.limite || 50;

      let allFiles = this.app.vault.getFiles().filter((f) => !this.ignored(f.path));
      let pastaExiste = false;
      if (pasta) {
        const resolvida = this.resolverPasta(pasta);
        if (resolvida.real === undefined) {
          return {
            consulta: { acao, pasta, extensao: ext, recursivo },
            total: 0,
            tempo_ms: Date.now() - startTime,
            resultados: [],
            dicas: this.dicasPastaNaoEncontrada(pasta, resolvida.sugestoes, resolvida.excluida),
          };
        }
        pastaExiste = true;
        const normPasta = resolvida.real;
        if (normPasta === "") {
          // Raiz: o Obsidian usa "/" como caminho da pasta raiz, mas aceita "" também.
          if (!recursivo) {
            allFiles = allFiles.filter((f) => f.parent?.path === "/" || f.parent?.path === "");
          }
        } else if (recursivo) {
          allFiles = allFiles.filter((f) => f.path.startsWith(normPasta + "/"));
        } else {
          allFiles = allFiles.filter((f) => f.parent?.path === normPasta);
        }
      }
      if (ext !== "*") {
        allFiles = allFiles.filter((f) => f.extension.toLowerCase() === ext);
      }
      if (params.filtro) {
        const normFiltro = norm(params.filtro);
        allFiles = allFiles.filter((f) => norm(f.name).includes(normFiltro));
      }

      allFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
      const total = allFiles.length;
      const slice = allFiles.slice(0, limite);

      const dicas: string[] = [];
      if (pastaExiste && total === 0 && ext !== "*") {
        dicas.push(`A pasta existe, mas não tem arquivos .${ext}. Use extensao: "*"${recursivo ? "" : " ou recursivo: true"}.`);
      }

      const resultados: SearchMatch[] = slice.map((f) => {
        const cache = this.app.metadataCache.getFileCache(f);
        const tags = cache?.frontmatter?.tags || cache?.tags?.map((t) => t.tag) || [];
        return {
          tipo: "arquivo",
          caminho: f.path,
          nome: f.name,
          extensao: f.extension,
          tamanho_bytes: f.stat.size,
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
          tags: Array.isArray(tags) ? tags : [tags],
        };
      });

      return {
        consulta: { acao, pasta: pasta || "/", extensao: ext, recursivo },
        total,
        tempo_ms: Date.now() - startTime,
        resultados,
        ...(dicas.length > 0 ? { dicas } : {}),
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 3: Obter Seção Específica de Nota
    // -------------------------------------------------------------
    if (acao === "obter_secao") {
      const notaAlvo = String(params.nota || "").trim();
      const cabecalhoAlvo = params.cabecalho ? String(params.cabecalho).toLowerCase().trim() : undefined;

      const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, this.excludedFolders));
      const resolucao = this.resolverNota(files, notaAlvo);
      const file = resolucao.file;

      if (!file) {
        return {
          consulta: { acao, nota: notaAlvo },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: resolucao.dicas,
        };
      }

      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const lines = content.split(/\r?\n/);

      // Suporte a intervalo de linhas (linha_inicio / linha_fim)
      if (params.linha_inicio !== undefined || params.linha_fim !== undefined) {
        const start = Math.max(1, params.linha_inicio ?? 1) - 1;
        const end = Math.min(lines.length, params.linha_fim ?? lines.length);
        const sliced = start < end ? lines.slice(start, end) : [];
        return {
          consulta: { acao, nota: file.basename, linha_inicio: start + 1, linha_fim: end },
          total: 1,
          tempo_ms: Date.now() - startTime,
          resultados: [
            {
              tipo: "nota",
              caminho: file.path,
              nome: file.basename,
              linha: start + 1,
              conteudo: sliced.join("\n"),
            },
          ],
          ...(resolucao.dicas.length > 0 ? { dicas: resolucao.dicas } : {}),
        };
      }

      if (!cabecalhoAlvo) {
        const headings = (cache?.headings || []).map((h) => ({
          nivel: h.level,
          titulo: h.heading,
          linha: h.position.start.line + 1,
        }));
        return {
          consulta: { acao, nota: file.basename },
          total: headings.length,
          tempo_ms: Date.now() - startTime,
          resultados: [
            {
              tipo: "nota",
              caminho: file.path,
              nome: file.basename,
              cabecalhos_disponiveis: headings,
            },
          ],
          ...(resolucao.dicas.length > 0 ? { dicas: resolucao.dicas } : {}),
        };
      }

      const headings = cache?.headings || [];
      let startIndex = -1;
      let endIndex = lines.length;
      let foundHeading: string | undefined;

      const escolhido = escolherCabecalho(headings, (h) => h.heading, cabecalhoAlvo);
      const i = escolhido ? headings.indexOf(escolhido) : -1;
      if (i >= 0) {
        const h = headings[i];
        startIndex = h.position.start.line;
        foundHeading = h.heading;
        for (let j = i + 1; j < headings.length; j++) {
          if (headings[j].level <= h.level) {
            endIndex = headings[j].position.start.line;
            break;
          }
        }
      }

      if (startIndex === -1) {
        return {
          consulta: { acao, nota: file.basename, cabecalho: cabecalhoAlvo },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: [
            ...resolucao.dicas,
            `Cabeçalho '${cabecalhoAlvo}' não encontrado. Disponíveis: ${headings.map((h) => h.heading).join(", ")}`,
          ],
        };
      }

      const sectionLines = lines.slice(startIndex, endIndex);
      return {
        consulta: { acao, nota: file.basename, cabecalho: foundHeading },
        total: 1,
        tempo_ms: Date.now() - startTime,
        resultados: [
          {
            tipo: "nota",
            caminho: file.path,
            nome: file.basename,
            secao_titulo: foundHeading,
            secao_linha: startIndex + 1,
            conteudo: sectionLines.join("\n"),
          },
        ],
        ...(resolucao.dicas.length > 0 ? { dicas: resolucao.dicas } : {}),
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 4: Estatísticas / Status do Cofre
    // -------------------------------------------------------------
    if (acao === "status") {
      const mdFiles = this.getMarkdownFiles();
      const allFiles = this.app.vault.getFiles().filter((f) => !this.ignored(f.path));
      const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && !this.ignored(f.path));

      const tagCounts: Record<string, number> = {};
      for (const file of mdFiles) {
        for (const t of this.extractTags(file)) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }

      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([tag, contagem]) => ({ tag, contagem }));

      const recentes: SearchMatch[] = [...mdFiles]
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 5)
        .map((f) => ({
          tipo: "nota",
          nome: f.basename,
          caminho: f.path,
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
        }));

      return {
        consulta: { acao },
        total: mdFiles.length,
        tempo_ms: Date.now() - startTime,
        estatisticas: {
          total_notas: mdFiles.length,
          total_arquivos_geral: allFiles.length,
          total_pastas: folders.length,
          top_tags: topTags,
        },
        resultados: recentes,
      };
    }

    // -------------------------------------------------------------
    // AÇÃO PADRÃO: Busca Híbrida de Notas
    // -------------------------------------------------------------
    // Sem nenhum critério a busca não devolve o cofre inteiro; pede um critério.
    // prop vazio ([] ou [""]) não conta como critério nem filtra.
    const propsValidas = ([] as string[])
      .concat(params.prop ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const temCriterio =
      (params.termos ?? []).some((t) => norm(t) !== "") ||
      Boolean(params.titulo || params.nota || params.filhas || params.arvore || params.tag || params.backlinks) ||
      propsValidas.length > 0;
    if (!temCriterio) {
      return {
        consulta: { acao },
        total: 0,
        tempo_ms: Date.now() - startTime,
        resultados: [],
        dicas: [
          "Informe ao menos um critério: termos, tag, filhas, arvore, backlinks, prop, titulo ou nota. Para listar arquivos de uma pasta use list_files; para achar por nome use find.",
        ],
      };
    }

    const files = this.getMarkdownFiles();
    // Pasta e extensão só restringem os candidatos; o índice e as demais ações seguem com todas as notas.
    let candidates = this.filtrarPorPasta(files, params.pasta);
    const ext = (params.extensao || "md").trim().replace(/^\./, "").toLowerCase();
    if (ext !== "*") {
      candidates = candidates.filter((f) => f.extension.toLowerCase() === ext);
    }

    if (params.titulo) {
      const tituloAlvo = norm(params.titulo);
      candidates = candidates.filter((f) => norm(f.basename).includes(tituloAlvo));
    }

    if (params.nota) {
      const alvo = norm(params.nota);
      const achadas = files.filter((f) => norm(f.basename) === alvo);
      return {
        consulta: { nota: params.nota },
        total: achadas.length,
        tempo_ms: Date.now() - startTime,
        resultados: achadas.map((f) => ({
          tipo: "nota",
          caminho: f.path,
          nome: f.basename,
          tags: this.extractTags(f),
          up: this.extractUp(f),
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
        })),
      };
    }

    if (params.filhas) {
      const alvo = norm(params.filhas);
      candidates = candidates.filter((f) => {
        const ups = this.extractUp(f);
        return ups.some((u) => norm(u) === alvo);
      });
    }

    if (params.arvore) {
      const raizNorm = norm(params.arvore);
      const raizes = files.filter((f) => norm(f.basename) === raizNorm);
      if (raizes.length === 0) {
        return {
          consulta: { acao, arvore: params.arvore },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: [`Nota raiz não encontrada: ${params.arvore}`],
        };
      }

      // Notas filhas indexadas pelo nome do pai (up:).
      const filhosDe = new Map<string, TFile[]>();
      for (const f of files) {
        for (const pai of this.extractUp(f)) {
          const chave = norm(pai);
          const lista = filhosDe.get(chave);
          if (lista) lista.push(f);
          else filhosDe.set(chave, [f]);
        }
      }

      // Busca em largura. Os paths já vistos (raízes incluídas) não entram de novo: ciclos param aqui.
      const maxProf = params.profundidade && params.profundidade > 0 ? params.profundidade : 10;
      const visitados = new Set(raizes.map((f) => f.path));
      const descendentes = new Set<string>();
      let nomesNivel = [raizNorm];
      for (let nivel = 1; nivel <= maxProf && nomesNivel.length > 0; nivel++) {
        const proximos: string[] = [];
        for (const nome of nomesNivel) {
          for (const filha of filhosDe.get(nome) ?? []) {
            if (visitados.has(filha.path)) continue;
            visitados.add(filha.path);
            descendentes.add(filha.path);
            proximos.push(norm(filha.basename));
          }
        }
        nomesNivel = proximos;
      }

      candidates = candidates.filter((f) => descendentes.has(f.path));
    }

    if (params.tag) {
      const tagAlvo = norm(params.tag.replace(/^#/, "").replace(/\/$/, ""));
      candidates = candidates.filter((f) => {
        const tags = this.extractTags(f).map((t) => norm(t));
        return tags.some((t) => t === tagAlvo || t.startsWith(tagAlvo + "/"));
      });
    }

    if (params.backlinks) {
      const alvo = norm(params.backlinks);
      candidates = candidates.filter((f) => {
        const links = this.extractOutlinks(f).map((l) => norm(l));
        const ups = this.extractUp(f).map((u) => norm(u));
        return links.includes(alvo) || ups.includes(alvo);
      });
    }

    if (propsValidas.length > 0) candidates = this.filtrarPorProp(candidates, propsValidas);

    // Termos viram palavras do índice; sinônimos só quando a busca não é exata.
    const opcoesTermos = { sinonimos: params.sinonimos === true, exato: params.exato === true };
    const termosConsulta = this.montarTermosConsulta(params.termos ?? [], opcoesTermos);
    const pediuTermos = (params.termos ?? []).some((t) => norm(t) !== "");
    let pontuacao: Map<string, number> | undefined;

    if (termosConsulta.length > 0) {
      await this.sincronizarIndice(files);
      const pontuados = this.indice.pontuar(termosConsulta, {
        exato: opcoesTermos.exato,
        candidatos: new Set(candidates.map((f) => f.path)),
      });
      pontuacao = pontuados;
      candidates = candidates.filter((f) => pontuados.has(f.path));
    } else if (pediuTermos) {
      // Termos sem nenhuma palavra buscável (só pontuação) não casam com nada.
      candidates = [];
    }

    // Ordena pela pontuação bruta; o campo pontos é só a versão arredondada para exibir.
    const ranqueados = candidates.map((file) => {
      const bruto = pontuacao?.get(file.path) ?? 0;
      return { file, bruto, pontos: pontuacao ? Math.max(1, Math.round(bruto * 10)) : undefined };
    });
    ranqueados.sort((a, b) => b.bruto - a.bruto || a.file.basename.localeCompare(b.file.basename));

    const total = ranqueados.length;
    const limite = params.limite ?? 10;
    const offset = Math.max(0, Math.floor(params.offset ?? 0));
    const pagina = limite > 0 ? ranqueados.slice(offset, offset + limite) : ranqueados.slice(offset);
    const restantes = Math.max(0, total - offset - pagina.length);

    // Trecho e seção são lidos só para a página devolvida.
    const paginados: SearchMatch[] = [];
    for (const { file, pontos } of pagina) {
      const tags = this.extractTags(file);
      const ups = this.extractUp(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};
      const achado: TrechoNota =
        termosConsulta.length > 0
          ? await this.localizarTrecho(file, termosConsulta, {
              exato: opcoesTermos.exato,
              secao: Boolean(params.secao),
              detalhe: params.detalhe === true,
            })
          : {};

      paginados.push({
        tipo: "nota",
        caminho: file.path,
        nome: file.basename,
        tags,
        up: ups,
        modificada: new Date(file.stat.mtime).toLocaleString("pt-BR"),
        pontos,
        linha: achado.linha,
        trecho: achado.trecho,
        secao_titulo: achado.secaoTitulo,
        secao_linha: achado.secaoLinha,
        secao_trecho: achado.secaoTrecho,
        skill: frontmatter.skill,
        efeito: frontmatter.efeito,
      });
    }

    // Com ler, só o primeiro resultado da página traz a seção em que o termo casou.
    if (params.ler === true && paginados.length > 0) {
      const primeiro = paginados[0];
      const file = files.find((f) => f.path === primeiro.caminho);
      if (file) {
        const sec = await this.lerSecaoDoResultado(file, primeiro.linha);
        primeiro.conteudo = sec.conteudo;
        if (sec.titulo !== undefined) {
          primeiro.secao_titulo = sec.titulo;
          primeiro.secao_linha = sec.linhaInicio;
        }
      }
    }

    const dicas = total === 0 ? this.dicasSemResultado(params, files, pediuTermos) : [];

    return {
      consulta: {
        acao,
        termos: params.termos,
        tag: params.tag,
        filhas: params.filhas,
        arvore: params.arvore,
        backlinks: params.backlinks,
        prop: params.prop,
      },
      total,
      tempo_ms: Date.now() - startTime,
      resultados: paginados,
      ...(restantes > 0 ? { restantes } : {}),
      ...(dicas.length > 0 ? { dicas } : {}),
    };
  }
}
