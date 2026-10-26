// Registers MCP tools for the AI Ecosystem
import { loadPdfJs, type App } from "obsidian";
import type { HubTool, HubToolResult } from "../ecosystem/types";
import { ContentCache } from "../search/content-cache";
import { parseExtensions, isUniversalRequest } from "../search/extensions";
import type { Conteudo } from "../search/file-content";
import { isAbsolutePath } from "../search/path-resolver";
import type { PdfLoader } from "../search/pdf-reader";
import { readTable, type LerTabelaParams } from "../search/read-table";
import type { VaultSearchEngine } from "../search/search-engine";
import type { SearchQueryParams, SearchResultPayload } from "../search/types";
import { findUniversal } from "../search/universal-find";
import { getSectionUniversal } from "../search/universal-read";
import { searchUniversal, type UniversalContext } from "../search/universal-search";
import { errorResult, jsonResult, ripgrepResult } from "./format";

// Lowercase extension of the last path segment; empty when there is none.
function extensaoDo(caminho: string): string {
  const nome = caminho.split(/[\\/]/).pop() ?? "";
  const ponto = nome.lastIndexOf(".");
  return ponto < 0 ? "" : nome.slice(ponto + 1).toLowerCase();
}

export function createSearchTools(
  app: App,
  engine: VaultSearchEngine,
  opts?: { pdfLoader?: PdfLoader },
): HubTool[] {
  // One content cache shared by every universal call of these tools.
  const cache = new ContentCache<Conteudo>();

  const contexto = (): UniversalContext => ({
    basePath: (app.vault as { adapter?: { getBasePath?: () => string } }).adapter?.getBasePath?.() ?? "",
    excluidas: engine.getExcludedFolders(),
    conteudo: { cache, pdfLoader: opts?.pdfLoader ?? loadPdfJs },
  });

  // Shared handler of `search` (universal) and of the legacy alias `search_notes` (note engine only).
  const buscarHandler = (nome: "search" | "search_notes") => async (args: Record<string, unknown>): Promise<HubToolResult> => {
    try {
      // The legacy alias never routes to the universal path, so it does not read the extensions.
      const exts = nome === "search" ? parseExtensions(args.extensoes as string[] | undefined, args.extensao as string | undefined) : [];
      const pasta = args.pasta as string | undefined;

      let result: SearchResultPayload;
      if (nome === "search" && isUniversalRequest(pasta, exts)) {
        result = await searchUniversal(
          {
            termos: (args.termos as string[]) ?? [],
            extensoes: exts,
            pasta,
            recursivo: args.recursivo !== false,
            limite: (args.limite as number) || 15,
          },
          contexto(),
        );
      } else {
        const queryParams: SearchQueryParams = {
          acao: (args.acao as SearchQueryParams["acao"]) || "buscar",
          pasta,
          extensao: args.extensao as string | undefined,
          recursivo: args.recursivo === true,
          cabecalho: args.cabecalho as string | undefined,
          linha_inicio: args.linha_inicio as number | undefined,
          linha_fim: args.linha_fim as number | undefined,
          termos: args.termos as string[] | undefined,
          tag: args.tag as string | undefined,
          filhas: args.filhas as string | undefined,
          arvore: args.arvore as string | undefined,
          backlinks: args.backlinks as string | undefined,
          prop: args.prop as string | undefined,
          nota: args.nota as string | undefined,
          titulo: args.titulo as string | undefined,
          secao: args.secao !== false,
          limite: (args.limite as number) || 10,
        };
        result = await engine.search(queryParams);
      }

      if (args.compacto === true) {
        return ripgrepResult(result);
      }
      return jsonResult(result);
    } catch (err) {
      return errorResult(`Erro na execução do ${nome}`, err);
    }
  };

  // Shared handler of `find` (universal) and of the legacy alias `find_notes` (note engine only).
  const acharHandler = (nome: "find" | "find_notes") => async (args: Record<string, unknown>): Promise<HubToolResult> => {
    try {
      const query = (args.query as string) || (args.padrao as string) || "";
      // The legacy alias never routes to the universal path, so it does not read the extensions.
      const exts = nome === "find" ? parseExtensions(args.extensoes as string[] | undefined) : [];
      const pasta = args.pasta as string | undefined;

      let result: SearchResultPayload;
      if (nome === "find" && isUniversalRequest(pasta, exts)) {
        result = await findUniversal(
          {
            query,
            extensoes: exts,
            pasta,
            limite: (args.limite as number) || 20,
          },
          contexto(),
        );
      } else {
        result = await engine.findNotes({
          query,
          pasta,
          tag: args.tag as string | undefined,
          limite: (args.limite as number) || 10,
        });
      }

      if (args.compacto === true) {
        return ripgrepResult(result);
      }
      return jsonResult(result);
    } catch (err) {
      return errorResult(`Erro na execução do ${nome}`, err);
    }
  };

  // Input properties of search_notes (legacy). `search` adds the universal ones below.
  const propsBuscaLegadas = {
    termos: {
      type: "array",
      items: { type: "string" },
      description: "Palavras-chave a buscar no conteúdo ou título",
    },
    titulo: {
      type: "string",
      description: "Filtro por título/nome da nota (para buscar apenas por nome, prefira find_notes)",
    },
    tag: {
      type: "string",
      description: "Filtro por tag (ex.: 'jira/instance')",
    },
    filhas: {
      type: "string",
      description: "Nome da nota-pai para listar filhas (up:)",
    },
    arvore: {
      type: "string",
      description: "Nome da nota raiz para listar descendentes (MOC)",
    },
    backlinks: {
      type: "string",
      description: "Lista notas que linkam para esta nota",
    },
    prop: {
      type: "string",
      description: "Filtro frontmatter (ex.: 'epico=PROJ-4')",
    },
    nota: {
      type: "string",
      description: "Nome ou caminho da nota para inspecionar metadados",
    },
    secao: {
      type: "boolean",
      default: true,
      description: "Inclui cabeçalho e trecho relevante da seção",
    },
    compacto: {
      type: "boolean",
      default: false,
      description: "Retorna linhas compactas estilo ripgrep (caminho:linha:trecho) para economia de tokens",
    },
    limite: {
      type: "integer",
      default: 10,
      description: "Máximo de resultados a retornar",
    },
  };

  const propsBuscaUniversais = {
    extensoes: {
      type: "array",
      items: { type: "string" },
      description: "Extensões a buscar sem ponto (ex.: ['ts', 'csv', 'pdf']). Use \"*\" para todos os tipos de arquivo; isso só busca fora do índice do cofre quando pasta é caminho absoluto ou quando há extensões explícitas.",
    },
    extensao: {
      type: "string",
      description: "Atalho com extensões separadas por vírgula (ex.: 'ts,py')",
    },
    pasta: {
      type: "string",
      description: "Pasta: caminho absoluto do computador ou relativo ao cofre",
    },
    recursivo: {
      type: "boolean",
      default: true,
      description: "Se verdadeiro, pesquisa também nas subpastas (pastas fora do cofre)",
    },
  };

  // Input properties of find_notes (legacy). `find` adds `extensoes` below.
  const propsAcharLegadas = {
    query: {
      type: "string",
      description: "Termo ou padrão a buscar no título ou caminho da nota (ex.: 'Plano de implementação', 'PROJ')",
    },
    pasta: {
      type: "string",
      description: "Pasta base opcional para restringir a busca",
    },
    tag: {
      type: "string",
      description: "Filtro opcional por tag",
    },
    limite: {
      type: "integer",
      default: 10,
      description: "Máximo de resultados a retornar",
    },
    compacto: {
      type: "boolean",
      default: false,
      description: "Retorna linhas compactas estilo ripgrep (caminho:linha:trecho) para economia de tokens",
    },
  };

  const searchTool: HubTool = {
    name: "search",
    title: "Search Files & Notes Content",
    description: "Busca termos no cofre ou em qualquer pasta do PC: código, texto, planilhas, PDF e DOCX.",
    categoria: "vault",
    tags: ["vault", "busca", "codigo", "planilha", "pdf"],
    resumo: "Busca universal de termos em notas, código, planilhas e documentos do cofre ou do PC",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: { ...propsBuscaLegadas, ...propsBuscaUniversais },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: buscarHandler("search"),
  };

  const findTool: HubTool = {
    name: "find",
    title: "Quick Find Files by Name",
    description: "Busca arquivos pelo nome no cofre ou em qualquer pasta do PC, por relevância.",
    categoria: "vault",
    tags: ["vault", "busca", "rapida", "nome", "arquivo"],
    resumo: "Busca rápida de arquivos por nome no cofre ou em pastas do computador",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        ...propsAcharLegadas,
        pasta: {
          type: "string",
          description: "Pasta base opcional: caminho absoluto do computador ou relativo ao cofre",
        },
        extensoes: {
          type: "array",
          items: { type: "string" },
          description: "Extensões a buscar sem ponto (ex.: ['ts', 'pdf']). Use \"*\" para todos os tipos de arquivo; isso só busca fora do índice do cofre quando pasta é caminho absoluto ou quando há extensões explícitas.",
        },
      },
      required: ["query"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: acharHandler("find"),
  };

  const searchNotesTool: HubTool = {
    name: "search_notes",
    title: "Search Vault Notes & Content",
    description: "Alias legado de search",
    categoria: "vault",
    tags: ["vault", "busca", "notas", "grafo", "bm25"],
    resumo: "Busca híbrida de notas no cofre por termos, tags, links ou frontmatter",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: propsBuscaLegadas,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: buscarHandler("search_notes"),
  };

  const findNotesTool: HubTool = {
    name: "find_notes",
    title: "Quick Find Notes by Title",
    description: "Alias legado de find",
    categoria: "vault",
    tags: ["vault", "busca", "rapida", "titulo", "switcher"],
    resumo: "Busca rápida de notas por título ou caminho no cofre",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: propsAcharLegadas,
      required: ["query"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: acharHandler("find_notes"),
  };

  const listFoldersTool: HubTool = {
    name: "list_folders",
    title: "List Vault Folders",
    description: "Lista as pastas do cofre e contagem de arquivos e subpastas.",
    categoria: "vault",
    tags: ["vault", "pastas", "diretorios"],
    resumo: "Lista pastas do cofre e contagem de itens",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        pasta: {
          type: "string",
          default: "",
          description: "Pasta base (vazio ou '/' para a raiz)",
        },
        recursivo: {
          type: "boolean",
          default: false,
          description: "Se verdadeiro, lista recursivamente todas as subpastas",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const queryParams: SearchQueryParams = {
          acao: "listar_pastas",
          pasta: (args.pasta as string) || "",
          recursivo: args.recursivo === true,
        };
        const result = await engine.search(queryParams);
        return jsonResult(result);
      } catch (err) {
        return errorResult("Erro na execução do list_folders", err);
      }
    },
  };

  const listFilesTool: HubTool = {
    name: "list_files",
    title: "List Vault Files",
    description: "Lista arquivos do cofre por pasta e extensão com tamanho e data.",
    categoria: "vault",
    tags: ["vault", "arquivos", "extensao"],
    resumo: "Lista arquivos do cofre por pasta e extensão",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        pasta: {
          type: "string",
          default: "",
          description: "Pasta base (vazio para todas ou raiz)",
        },
        extensao: {
          type: "string",
          default: "md",
          description: "Extensão dos arquivos (ex.: 'md', 'png', '*' para todos)",
        },
        recursivo: {
          type: "boolean",
          default: false,
          description: "Se verdadeiro, pesquisa também nas subpastas",
        },
        filtro: {
          type: "string",
          description: "Filtro opcional por nome ou padrão de arquivo (case-insensitive)",
        },
        limite: {
          type: "integer",
          default: 50,
          description: "Máximo de arquivos a retornar",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const queryParams: SearchQueryParams = {
          acao: "listar_arquivos",
          pasta: (args.pasta as string) || "",
          extensao: (args.extensao as string) || "md",
          filtro: args.filtro as string | undefined,
          recursivo: args.recursivo === true,
          limite: (args.limite as number) || 50,
        };
        const result = await engine.search(queryParams);
        return jsonResult(result);
      } catch (err) {
        return errorResult("Erro na execução do list_files", err);
      }
    },
  };

  const getSectionTool: HubTool = {
    name: "get_section",
    title: "Get Note Section or Headings",
    description: "Lê seção, símbolo, linhas ou páginas de um arquivo (código, md, docx, pdf, txt)",
    categoria: "vault",
    tags: ["vault", "secao", "cabecalhos", "markdown"],
    resumo: "Lê seção, símbolo, linhas ou páginas de um arquivo do cofre ou do PC (código, md, docx, pdf, txt)",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        arquivo: {
          type: "string",
          description: "Caminho absoluto do computador ou relativo ao cofre (.ts/.py/.md/.docx/.pdf/.txt/.csv)",
        },
        nota: {
          type: "string",
          description: "Alias legado de arquivo (nome ou caminho relativo da nota)",
        },
        secao: {
          type: "string",
          description: "Símbolo, cabeçalho ou título. Omitir para listar os cabeçalhos",
        },
        cabecalho: {
          type: "string",
          description: "Alias legado de secao",
        },
        linha_inicio: {
          type: "integer",
          description: "Linha inicial para leitura por intervalo (1-based)",
        },
        linha_fim: {
          type: "integer",
          description: "Linha final para leitura por intervalo (inclusiva)",
        },
        pagina_inicio: {
          type: "integer",
          description: "Página inicial (PDF e DOCX)",
        },
        pagina_fim: {
          type: "integer",
          description: "Página final (inclusiva)",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const arquivo = (args.arquivo ?? undefined) as string | undefined;
        const alvo = (arquivo ?? args.nota) as string | undefined;
        if (!alvo) {
          return errorResult("Erro na execução do get_section", "informe 'arquivo'");
        }
        // The universal reader handles absolute paths (from `arquivo` or `nota`) and `arquivo` with a non-Markdown extension.
        // A relative `nota` stays on the note engine, so "Plano v1.2" is never treated as extension "2".
        const ext = extensaoDo(alvo);
        if (isAbsolutePath(alvo) || (arquivo !== undefined && ext !== "" && ext !== "md")) {
          const result = await getSectionUniversal(
            {
              arquivo: alvo,
              secao: (args.secao ?? args.cabecalho) as string | undefined,
              linha_inicio: args.linha_inicio as number | undefined,
              linha_fim: args.linha_fim as number | undefined,
              pagina_inicio: args.pagina_inicio as number | undefined,
              pagina_fim: args.pagina_fim as number | undefined,
            },
            contexto(),
          );
          return jsonResult(result);
        }
        const queryParams: SearchQueryParams = {
          acao: "obter_secao",
          nota: alvo,
          cabecalho: (args.cabecalho ?? args.secao) as string | undefined,
          linha_inicio: args.linha_inicio as number | undefined,
          linha_fim: args.linha_fim as number | undefined,
        };
        const result = await engine.search(queryParams);
        return jsonResult(result);
      } catch (err) {
        return errorResult("Erro na execução do get_section", err);
      }
    },
  };

  const readTableTool: HubTool = {
    name: "read_table",
    title: "Read Spreadsheet or CSV Table",
    description: "Lê planilha (.xlsx) ou CSV/TSV com aba, colunas, paginação e formato",
    categoria: "vault",
    tags: ["vault", "tabela", "excel", "csv", "planilha"],
    resumo: "Lê planilha .xlsx ou CSV/TSV por aba, colunas e linhas, em markdown, json ou csv",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        arquivo: {
          type: "string",
          description: "Caminho absoluto do computador ou relativo ao cofre (.xlsx, .csv, .tsv)",
        },
        aba: {
          type: "string",
          description: "Nome da aba (planilhas .xlsx)",
        },
        linha_inicio: {
          type: "integer",
          default: 2,
          description: "Primeira linha a ler (1-based)",
        },
        linha_fim: {
          type: "integer",
          description: "Última linha a ler (inclusiva)",
        },
        colunas: {
          type: "array",
          items: { type: "string" },
          description: "Colunas por letra (ex.: 'A', 'C') ou nome do cabeçalho",
        },
        formato: {
          type: "string",
          enum: ["markdown", "json", "csv"],
          default: "markdown",
          description: "Formato da tabela na resposta",
        },
      },
      required: ["arquivo"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const arquivo = args.arquivo as string | undefined;
        if (!arquivo) {
          return errorResult("Erro na execução do read_table", "informe 'arquivo'");
        }
        const params: LerTabelaParams = {
          arquivo,
          aba: args.aba as string | undefined,
          linha_inicio: args.linha_inicio as number | undefined,
          linha_fim: args.linha_fim as number | undefined,
          colunas: args.colunas as string[] | undefined,
          formato: args.formato as LerTabelaParams["formato"],
        };
        return jsonResult(await readTable(params, contexto()));
      } catch (err) {
        return errorResult("Erro na execução do read_table", err);
      }
    },
  };

  return [
    searchTool,
    findTool,
    searchNotesTool,
    findNotesTool,
    listFoldersTool,
    listFilesTool,
    getSectionTool,
    readTableTool,
  ];
}
