// Registers MCP tools for the AI Ecosystem
import type { App } from "obsidian";
import type { HubTool, HubToolResult } from "../ecosystem/types";
import type { VaultSearchEngine } from "../search/search-engine";
import type { SearchQueryParams } from "../search/types";

export function createSearchTools(app: App, engine: VaultSearchEngine): HubTool[] {
  const searchNotesTool: HubTool = {
    name: "search_notes",
    title: "Search Vault Notes & Content",
    description:
      "Busca híbrida de notas no cofre em tempo real na memória RAM do Obsidian (grafo de links, tags, BM25, frontmatter e seções de Markdown). Use prioritariamente para pesquisar termos, tags, notas-filhas (up:), backlinks e propriedades.",
    inputSchema: {
      type: "object",
      properties: {
        termos: {
          type: "array",
          items: { type: "string" },
          description: "Palavras-chave a buscar no conteúdo ou título das notas",
        },
        tag: {
          type: "string",
          description: "Filtra por tag (ex.: 'jira/instance', 'company/telecall')",
        },
        filhas: {
          type: "string",
          description: "Nome da nota-pai para listar filhas (propriedade up:)",
        },
        arvore: {
          type: "string",
          description: "Nome da nota para listar descendentes a partir de um MOC",
        },
        backlinks: {
          type: "string",
          description: "Lista notas que linkam para esta nota",
        },
        prop: {
          type: "string",
          description: "Filtra por chave/valor no frontmatter (ex.: 'epico=DEVAT-4')",
        },
        nota: {
          type: "string",
          description: "Nome da nota ou caminho relativo para inspecionar metadados",
        },
        secao: {
          type: "boolean",
          default: true,
          description: "Se verdadeiro, inclui cabeçalho e snippet relevante na busca de notas",
        },
        limite: {
          type: "integer",
          default: 10,
          description: "Máximo de resultados a retornar",
        },
        acao: {
          type: "string",
          enum: ["buscar", "listar_pastas", "listar_arquivos", "obter_secao", "status"],
          default: "buscar",
          description: "Ação a executar (padrão: 'buscar')",
        },
        pasta: {
          type: "string",
          description: "Pasta base para listar_pastas ou listar_arquivos",
        },
        extensao: {
          type: "string",
          description: "Extensão para listar_arquivos",
        },
        recursivo: {
          type: "boolean",
          description: "Se recursivo",
        },
        cabecalho: {
          type: "string",
          description: "Título da seção para obter_secao",
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
          termos: args.termos as string[] | undefined,
          tag: args.tag as string | undefined,
          filhas: args.filhas as string | undefined,
          arvore: args.arvore as string | undefined,
          backlinks: args.backlinks as string | undefined,
          prop: args.prop as string | undefined,
          nota: args.nota as string | undefined,
          secao: args.secao !== false,
          limite: (args.limite as number) || 10,
        };

        const result = await engine.search(queryParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Erro na execução do search_notes: ${String(err)}`,
            },
          ],
        };
      }
    },
  };

  const listFoldersTool: HubTool = {
    name: "list_folders",
    title: "List Vault Folders",
    description:
      "Lista as pastas do cofre e contagem de arquivos/subpastas diretamente pela API do Obsidian em RAM. Use prioritariamente para explorar a estrutura de diretórios do cofre.",
    inputSchema: {
      type: "object",
      properties: {
        pasta: {
          type: "string",
          default: "",
          description: "Caminho da pasta base (vazio ou '/' para a raiz do cofre)",
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Erro na execução do list_folders: ${String(err)}`,
            },
          ],
        };
      }
    },
  };

  const listFilesTool: HubTool = {
    name: "list_files",
    title: "List Vault Files",
    description:
      "Lista arquivos do cofre por pasta e/ou extensão em RAM, com tamanho, data de modificação e tags. Use prioritariamente para descobrir e filtrar arquivos no cofre.",
    inputSchema: {
      type: "object",
      properties: {
        pasta: {
          type: "string",
          default: "",
          description: "Caminho da pasta (vazio para todas ou raiz)",
        },
        extensao: {
          type: "string",
          default: "md",
          description: "Extensão dos arquivos (ex.: 'md', 'png', 'py', '*' para todos)",
        },
        recursivo: {
          type: "boolean",
          default: false,
          description: "Se verdadeiro, pesquisa também nas subpastas",
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
          recursivo: args.recursivo === true,
          limite: (args.limite as number) || 50,
        };
        const result = await engine.search(queryParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Erro na execução do list_files: ${String(err)}`,
            },
          ],
        };
      }
    },
  };

  const getSectionTool: HubTool = {
    name: "get_section",
    title: "Get Note Section or Headings",
    description:
      "Lê uma seção específica ou lista os cabeçalhos de uma nota Markdown diretamente pela memória RAM do Obsidian. Sem 'cabecalho', lista todos os cabeçalhos da nota. Com 'cabecalho', extrai o conteúdo exato daquela seção.",
    inputSchema: {
      type: "object",
      properties: {
        nota: {
          type: "string",
          description: "Nome da nota ou caminho relativo (ex.: 'CLAUDE' ou 'CLAUDE.md')",
        },
        cabecalho: {
          type: "string",
          description: "Título ou fragmento do cabeçalho markdown desejado. Se omitido, retorna a lista de todos os cabeçalhos disponíveis na nota.",
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
        };
        const result = await engine.search(queryParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Erro na execução do get_section: ${String(err)}`,
            },
          ],
        };
      }
    },
  };

  return [searchNotesTool, listFoldersTool, listFilesTool, getSectionTool];
}
