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
import { enxugar, errorResult, jsonResult, ripgrepResult } from "./format";

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

  const buscarHandler = async (args: Record<string, unknown>): Promise<HubToolResult> => {
    try {
      const exts = parseExtensions(args.extensoes as string[] | undefined, args.extensao as string | undefined);
      const pasta = args.pasta as string | undefined;
      const detalhe = args.detalhe === true;

      let result: SearchResultPayload;
      // Só a busca universal agrupa os trechos por arquivo.
      let agrupar = false;
      if (isUniversalRequest(pasta, exts)) {
        agrupar = true;
        result = await searchUniversal(
          {
            termos: (args.termos as string[]) ?? [],
            extensoes: exts,
            pasta,
            recursivo: args.recursivo !== false,
            limite: (args.limite as number) || 10,
          },
          contexto(),
        );
      } else {
        const queryParams: SearchQueryParams = {
          acao: "buscar",
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
          profundidade: args.profundidade as number | undefined,
          backlinks: args.backlinks as string | undefined,
          prop: args.prop as string | string[] | undefined,
          nota: args.nota as string | undefined,
          titulo: args.titulo as string | undefined,
          secao: args.secao !== false,
          detalhe: args.detalhe === true,
          limite: (args.limite as number) || 10,
          offset: args.offset as number | undefined,
          sinonimos: args.sinonimos === true,
          exato: args.exato === true,
          ler: args.ler === true,
        };
        result = await engine.search(queryParams);
      }

      // Compact by default; detalhe or ler need the JSON fields, and compacto: false forces JSON.
      const compacto = args.compacto === undefined ? !detalhe && args.ler !== true : args.compacto === true;
      if (compacto) {
        return ripgrepResult(result);
      }
      return jsonResult(enxugar(result, detalhe, agrupar));
    } catch (err) {
      return errorResult("Erro na execução do search", err);
    }
  };

  const acharHandler = async (args: Record<string, unknown>): Promise<HubToolResult> => {
    try {
      const query = (args.query as string) || (args.padrao as string) || "";
      const exts = parseExtensions(args.extensoes as string[] | undefined);
      const pasta = args.pasta as string | undefined;
      const detalhe = args.detalhe === true;

      let result: SearchResultPayload;
      if (isUniversalRequest(pasta, exts)) {
        result = await findUniversal(
          {
            query,
            extensoes: exts,
            pasta,
            limite: (args.limite as number) || 10,
            offset: args.offset as number | undefined,
          },
          contexto(),
        );
      } else {
        result = await engine.findNotes({
          query,
          pasta,
          tag: args.tag as string | undefined,
          limite: (args.limite as number) || 10,
          offset: args.offset as number | undefined,
        });
      }

      // Compact by default; detalhe needs the JSON fields, and compacto: false forces JSON.
      const compacto = args.compacto === undefined ? !detalhe : args.compacto === true;
      if (compacto) {
        return ripgrepResult(result);
      }
      return jsonResult(enxugar(result, detalhe));
    } catch (err) {
      return errorResult("Erro na execução do find", err);
    }
  };

  // Input properties of search for vault notes; the universal ones are added below.
  const propsBusca = {
    termos: {
      type: "array",
      items: { type: "string" },
      description: "Palavras-chave a buscar no conteúdo ou título",
    },
    titulo: {
      type: "string",
      description: "Filtro por título/nome da nota (para buscar apenas por nome, prefira find)",
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
      description: "Nome da nota raiz: lista as notas descendentes pelo campo up: (filhas, netas...), até `profundidade` níveis",
    },
    profundidade: {
      type: "integer",
      default: 10,
      description: "Níveis de descendentes a seguir em arvore (padrão 10)",
    },
    backlinks: {
      type: "string",
      description: "Lista notas que linkam para esta nota",
    },
    prop: {
      type: ["string", "array"],
      items: { type: "string" },
      description: "Filtro de frontmatter 'chave=valor' (ex.: 'epico=PROJ-4'); em lista, todas as condições devem valer",
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
      default: true,
      description: "Retorna linhas compactas estilo ripgrep (caminho:linha:trecho) para economia de tokens. Padrão: ligado; passe false (ou use detalhe) para o JSON completo",
    },
    limite: {
      type: "integer",
      default: 10,
      description: "Máximo de resultados a retornar",
    },
    sinonimos: {
      type: "boolean",
      default: false,
      description: "Expande os termos por sinônimos (ex.: fluxo = automação = workflow). Padrão: desligado",
    },
    exato: {
      type: "boolean",
      default: false,
      description: "Casa só palavras inteiras e ignora sinônimos",
    },
    detalhe: {
      type: "boolean",
      default: false,
      description: "Resposta longa: trecho de 200 caracteres, trecho da seção, tags, up, pontos e datas. Padrão: só caminho, linha, trecho curto e seção",
    },
    ler: {
      type: "boolean",
      default: false,
      description: "Devolve também o texto da seção em que o termo casou, no primeiro resultado (poupa um get_section)",
    },
    offset: {
      type: "integer",
      default: 0,
      description: "Quantos resultados pular (paginação); a resposta traz restantes quando há mais",
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

  // Input properties of find for vault notes; `find` adds `extensoes` below.
  const propsAchar = {
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
      default: true,
      description: "Retorna linhas compactas estilo ripgrep (caminho:linha:trecho) para economia de tokens. Padrão: ligado; passe false (ou use detalhe) para o JSON completo",
    },
    detalhe: {
      type: "boolean",
      default: false,
      description: "Resposta longa: inclui tags, up, pontos e datas. Padrão: só caminho, tipo e tamanho",
    },
    offset: {
      type: "integer",
      default: 0,
      description: "Quantos resultados pular (paginação); a resposta traz restantes quando há mais",
    },
  };

  const searchTool: HubTool = {
    name: "search",
    title: "Search Files & Notes Content",
    description:
      "PRIMARY content search tool for this workspace (the Obsidian vault and any folder on the PC). " +
      "Searches inside notes, tags, sections, links, code, text, CSV/XLSX, DOCX and PDF using an ultra-fast in-memory index. " +
      "ALWAYS use this instead of the built-in Grep, Glob, Bash (grep, rg, find, Select-String) or PowerShell for any content search; " +
      "the built-in search tools are slower, unaudited and blocked inside the vault. " +
      "To find a file by name or path, use find. To read a match, use get_section.",
    categoria: "vault",
    tags: ["vault", "busca", "codigo", "planilha", "pdf"],
    resumo: "Busca universal de termos em notas, código, planilhas e documentos do cofre ou do PC",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: { ...propsBusca, ...propsBuscaUniversais },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: buscarHandler,
  };

  const findTool: HubTool = {
    name: "find",
    title: "Quick Find Files by Name",
    description:
      "PRIMARY file finder for this workspace: locates notes and files by name or path (Quick Switcher style, under 2 ms, in memory), " +
      "in the vault or in any folder on the PC (absolute path or non-md extension). " +
      "ALWAYS use this instead of the built-in Glob, Bash (find, ls -R) or PowerShell (Get-ChildItem -Recurse) to find, list or count files. " +
      "It does not read file bodies: to search inside files use search, to read one use get_section.",
    categoria: "vault",
    tags: ["vault", "busca", "rapida", "nome", "arquivo"],
    resumo: "Busca rápida de arquivos por nome no cofre ou em pastas do computador",
    efeito: "leitura",
    exposicao: "fixa",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        ...propsAchar,
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
    handler: acharHandler,
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

  const listTagsTool: HubTool = {
    name: "list_tags",
    title: "List Vault Tags",
    description: "Lists the tags used in the vault with how many notes use each, optionally filtered by prefix.",
    categoria: "vault",
    tags: ["vault", "tags"],
    resumo: "Lista as tags do cofre com a contagem de notas",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        prefixo: {
          type: "string",
          description: "Só tags que começam com este prefixo (ex.: 'jira' traz jira, jira/instance)",
        },
        limite: {
          type: "integer",
          default: 50,
          description: "Máximo de tags a retornar (0 = todas)",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const prefixo = args.prefixo as string | undefined;
        const result = engine.listarTags({
          prefixo,
          limite: (args.limite as number) ?? 50,
        });
        const dicas: string[] = [];
        if (result.total === 0) {
          dicas.push(
            prefixo
              ? `Nenhuma tag começa com "${prefixo}". Use list_tags sem prefixo para ver as existentes.`
              : "O cofre não tem tags nas notas.",
          );
        }
        if (result.restantes) {
          dicas.push(`Há mais ${result.restantes} tags. Use limite maior ou 0 para todas.`);
        }
        return jsonResult(dicas.length > 0 ? { ...result, dicas } : result);
      } catch (err) {
        return errorResult("Erro na execução do list_tags", err);
      }
    },
  };

  const recentNotesTool: HubTool = {
    name: "recent_notes",
    title: "Recently Modified Notes",
    description: "Lists the most recently modified notes, optionally limited to a folder or a tag.",
    categoria: "vault",
    tags: ["vault", "recentes"],
    resumo: "Lista as notas modificadas mais recentemente",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        limite: {
          type: "integer",
          default: 10,
          description: "Máximo de notas a retornar",
        },
        pasta: {
          type: "string",
          description: "Só notas desta pasta do cofre (inclui subpastas)",
        },
        tag: {
          type: "string",
          description: "Só notas com esta tag (inclui tags filhas, ex.: 'jira' traz 'jira/instance')",
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      try {
        const r = engine.notasRecentes({
          limite: (args.limite as number) || 10,
          pasta: args.pasta as string | undefined,
          tag: args.tag as string | undefined,
        });
        const dicas =
          r.total === 0
            ? ["Nenhuma nota encontrada com esses filtros. Confira o nome da pasta com list_folders ou o da tag com list_tags."]
            : [];
        return jsonResult({
          total: r.total,
          resultados: r.resultados.map((x) => ({ caminho: x.caminho, modificada: x.modificada })),
          ...(dicas.length > 0 ? { dicas } : {}),
        });
      } catch (err) {
        return errorResult("Erro na execução do recent_notes", err);
      }
    },
  };

  const getSectionTool: HubTool = {
    name: "get_section",
    title: "Get Note Section or Headings",
    description:
      "PRIMARY reader for notes and files in this workspace: reads one section, symbol, line range or page range, or lists the headings, " +
      "of md, code, txt, csv, docx and pdf files (vault relative path or absolute path). " +
      "ALWAYS prefer this over the built-in Read, Bash (cat, head, tail, sed) or PowerShell (Get-Content) to read only the part you need and save tokens. " +
      "For spreadsheets use read_table.",
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
        pedidos: {
          type: "array",
          maxItems: 10,
          description: "Vários pedidos numa chamada (máx. 10); cada item aceita arquivo, secao, linha_inicio, linha_fim, pagina_inicio e pagina_fim",
          items: {
            type: "object",
            properties: {
              arquivo: { type: "string" },
              secao: { type: "string" },
              linha_inicio: { type: "integer" },
              linha_fim: { type: "integer" },
              pagina_inicio: { type: "integer" },
              pagina_fim: { type: "integer" },
            },
          },
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    handler: async (args: Record<string, unknown>): Promise<HubToolResult> => {
      // Lê um pedido com a leitura de sempre; undefined quando não há arquivo nem nota.
      const lerUm = async (a: Record<string, unknown>): Promise<SearchResultPayload | undefined> => {
        const arquivo = (a.arquivo ?? undefined) as string | undefined;
        const alvo = (arquivo ?? a.nota) as string | undefined;
        if (!alvo) {
          return undefined;
        }
        // The universal reader handles absolute paths (from `arquivo` or `nota`) and `arquivo` with a non-Markdown extension.
        // A relative `nota` stays on the note engine, so "Plano v1.2" is never treated as extension "2".
        const ext = extensaoDo(alvo);
        if (isAbsolutePath(alvo) || (arquivo !== undefined && ext !== "" && ext !== "md")) {
          return getSectionUniversal(
            {
              arquivo: alvo,
              secao: (a.secao ?? a.cabecalho) as string | undefined,
              linha_inicio: a.linha_inicio as number | undefined,
              linha_fim: a.linha_fim as number | undefined,
              pagina_inicio: a.pagina_inicio as number | undefined,
              pagina_fim: a.pagina_fim as number | undefined,
            },
            contexto(),
          );
        }
        const queryParams: SearchQueryParams = {
          acao: "obter_secao",
          nota: alvo,
          cabecalho: (a.cabecalho ?? a.secao) as string | undefined,
          linha_inicio: a.linha_inicio as number | undefined,
          linha_fim: a.linha_fim as number | undefined,
        };
        return engine.search(queryParams);
      };

      try {
        if (Array.isArray(args.pedidos)) {
          // Vários pedidos numa chamada: lidos em sequência, no máximo 10.
          const pedidos = args.pedidos as Record<string, unknown>[];
          const resultados: SearchResultPayload["resultados"] = [];
          const dicas: string[] = [];
          for (const [i, pedido] of pedidos.slice(0, 10).entries()) {
            const n = i + 1;
            const unico = await lerUm(pedido);
            if (unico === undefined) {
              dicas.push(`Pedido ${n}: informe 'arquivo'`);
              continue;
            }
            resultados.push(...unico.resultados);
            dicas.push(...(unico.dicas ?? []).map((d) => `Pedido ${n}: ${d}`));
          }
          if (pedidos.length > 10) {
            dicas.push("Só os 10 primeiros pedidos foram lidos");
          }
          return jsonResult({ total: resultados.length, resultados, dicas });
        }

        const unico = await lerUm(args);
        if (unico === undefined) {
          return errorResult("Erro na execução do get_section", "informe 'arquivo'");
        }
        return jsonResult(unico);
      } catch (err) {
        return errorResult("Erro na execução do get_section", err);
      }
    },
  };

  const getNoteTool: HubTool = {
    name: "get_note",
    title: "Get Note Structure",
    description:
      "Reads one vault note in a single call: selected frontmatter, heading outline, outgoing links and, optionally, the first N characters of the body. " +
      "Prefer it over get_section when you need structure or metadata, not a specific section.",
    categoria: "vault",
    tags: ["vault", "nota", "frontmatter", "outline", "links"],
    resumo: "Lê uma nota: frontmatter, esboço dos cabeçalhos, links de saída e início do corpo",
    efeito: "leitura",
    exposicao: "indice",
    aprovacao: "dispensada",
    inputSchema: {
      type: "object",
      properties: {
        nota: {
          type: "string",
          description: "Nome ou caminho da nota",
        },
        frontmatter: {
          type: "array",
          items: { type: "string" },
          description: "Chaves do frontmatter a devolver; ['*'] ou omitido = todas; [] = nenhuma",
        },
        outline: {
          type: "boolean",
          default: true,
          description: "Esboço dos cabeçalhos",
        },
        outlinks: {
          type: "boolean",
          default: true,
          description: "Links de saída",
        },
        corpo: {
          type: "integer",
          default: 0,
          description: "Se > 0, devolve os primeiros N caracteres do corpo",
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
        const nota = args.nota as string | undefined;
        if (!nota) {
          return errorResult("Erro na execução do get_note", "informe 'nota'");
        }
        const result = await engine.lerNota({
          nota,
          frontmatter: args.frontmatter as string[] | undefined,
          outline: args.outline as boolean | undefined,
          outlinks: args.outlinks as boolean | undefined,
          corpo: args.corpo as number | undefined,
        });
        return jsonResult(enxugar(result, false));
      } catch (err) {
        return errorResult("Erro na execução do get_note", err);
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
    listFoldersTool,
    listFilesTool,
    listTagsTool,
    recentNotesTool,
    getSectionTool,
    getNoteTool,
    readTableTool,
  ];
}
