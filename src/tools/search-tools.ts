// Registers MCP tools for the AI Ecosystem
import type { App } from "obsidian";
import type { HubTool, HubToolResult } from "../ecosystem/types";
import type { VaultSearchEngine } from "../search/search-engine";
import type { SearchQueryParams } from "../search/types";
import { errorResult, jsonResult, ripgrepResult } from "./format";

export function createSearchTools(app: App, engine: VaultSearchEngine): HubTool[] {
  const searchNotesTool: HubTool = {
    name: "search_notes",
    title: "Search Vault Notes & Content",
    description: "Busca híbrida no CONTEÚDO das notas (texto, seções, BM25, tags, grafo). Para o que está escrito dentro.",
    categoria: "vault",
    tags: ["vault", "busca", "notas", "grafo", "bm25"],
    resumo: "Busca híbrida de notas no cofre por termos, tags, links ou frontmatter",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
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
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const queryParams: SearchQueryParams = {
          acao: (args.acao as SearchQueryParams["acao"]) || "buscar",
          pasta: args.pasta as string | undefined,
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

        const result = await engine.search(queryParams);
        if (args.compacto === true) {
          return ripgrepResult(result);
        }
        return jsonResult(result);
      } catch (err) {
        return errorResult("Erro na execução do search_notes", err);
      }
    },
  };

  const findNotesTool: HubTool = {
    name: "find_notes",
    title: "Quick Find Notes by Title",
    description: "Busca rápida de notas por título ou caminho (Quick Switcher). Para achar notas pelo nome sem ler o conteúdo.",
    categoria: "vault",
    tags: ["vault", "busca", "rapida", "titulo", "switcher"],
    resumo: "Busca rápida de notas por título ou caminho no cofre",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
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
      },
      required: ["query"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const result = await engine.findNotes({
          query: (args.query as string) || (args.padrao as string) || "",
          pasta: args.pasta as string | undefined,
          tag: args.tag as string | undefined,
          limite: (args.limite as number) || 10,
        });
        if (args.compacto === true) {
          return ripgrepResult(result);
        }
        return jsonResult(result);
      } catch (err) {
        return errorResult("Erro na execução do find_notes", err);
      }
    },
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
    description: "Lê uma seção ou lista os cabeçalhos de uma nota Markdown.",
    categoria: "vault",
    tags: ["vault", "secao", "cabecalhos", "markdown"],
    resumo: "Lê seção ou cabeçalhos de uma nota Markdown",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        nota: {
          type: "string",
          description: "Nome ou caminho relativo da nota (ex.: 'CLAUDE.md')",
        },
        cabecalho: {
          type: "string",
          description: "Título da seção. Omitir para listar todos os cabeçalhos",
        },
        linha_inicio: {
          type: "integer",
          description: "Linha inicial para leitura por intervalo (1-based)",
        },
        linha_fim: {
          type: "integer",
          description: "Linha final para leitura por intervalo (inclusiva)",
        },
      },
      required: ["nota"],
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const queryParams: SearchQueryParams = {
          acao: "obter_secao",
          nota: args.nota as string,
          cabecalho: args.cabecalho as string | undefined,
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

  return [searchNotesTool, findNotesTool, listFoldersTool, listFilesTool, getSectionTool];
}
