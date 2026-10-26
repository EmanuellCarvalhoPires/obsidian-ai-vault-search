import { describe, expect, it, vi } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";
import type { AIEcosystemAPI, ToolIndexEntry } from "../src/ecosystem/types";

describe("tools index metadata and schema optimization (Etapa 8)", () => {
  const app = fakeVault([{ path: "Nota.md", content: "# Titulo\nConteudo\n" }]);
  const engine = new VaultSearchEngine(app);
  const tools = createSearchTools(app, engine);

  it("registers exactly 8 tools with correct vault category and reading effect", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "search",
      "find",
      "search_notes",
      "find_notes",
      "list_folders",
      "list_files",
      "get_section",
      "read_table",
    ]);

    for (const tool of tools) {
      expect(tool.categoria).toBe("vault");
      expect(tool.efeito).toBe("leitura");
      expect(tool.aprovacao).toBe("dispensada");
      expect(tool.resumo).toBeDefined();
      expect(tool.resumo!.length).toBeLessThanOrEqual(100);
      expect(tool.tags).toBeDefined();
      expect(tool.tags!.length).toBeGreaterThan(0);
    }
  });

  it("marks search, find, get_section and read_table as exposicao: 'fixa' with shortened descriptions", () => {
    const search = tools.find((t) => t.name === "search")!;
    expect(search.exposicao).toBe("fixa");
    expect(search.description.length).toBeLessThan(600);

    const find = tools.find((t) => t.name === "find")!;
    expect(find.exposicao).toBe("fixa");
    expect(find.description.length).toBeLessThan(600);

    const getSection = tools.find((t) => t.name === "get_section")!;
    expect(getSection.exposicao).toBe("fixa");
    expect(getSection.description.length).toBeLessThan(600);

    const readTable = tools.find((t) => t.name === "read_table")!;
    expect(readTable.exposicao).toBe("fixa");
    expect(readTable.description.length).toBeLessThan(120);
  });

  it("keeps search_notes and find_notes as legacy aliases with exposicao: 'indice'", () => {
    const searchNotes = tools.find((t) => t.name === "search_notes")!;
    expect(searchNotes.exposicao).toBe("indice");
    expect(searchNotes.description).toContain("Legacy alias of search");

    const findNotes = tools.find((t) => t.name === "find_notes")!;
    expect(findNotes.exposicao).toBe("indice");
    expect(findNotes.description).toContain("Legacy alias of find");
  });

  it("gives search the universal inputSchema fields and keeps find_notes legacy schema", () => {
    const search = tools.find((t) => t.name === "search")!;
    const props = search.inputSchema.properties as Record<string, unknown>;
    expect(props.pasta).toBeDefined();
    expect(props.extensoes).toBeDefined();
    expect(props.extensao).toBeDefined();
    expect(props.recursivo).toBeDefined();

    const findNotes = tools.find((t) => t.name === "find_notes")!;
    const findProps = findNotes.inputSchema.properties as Record<string, unknown>;
    expect(findProps.extensoes).toBeUndefined();
    expect(findNotes.inputSchema.required).toEqual(["query"]);
  });

  it("optimizes search_notes inputSchema by removing redundant legacy fields", () => {
    const searchNotes = tools.find((t) => t.name === "search_notes")!;
    const props = searchNotes.inputSchema.properties as Record<string, unknown>;

    // Kept parameters
    expect(props.termos).toBeDefined();
    expect(props.tag).toBeDefined();
    expect(props.filhas).toBeDefined();
    expect(props.arvore).toBeDefined();
    expect(props.backlinks).toBeDefined();
    expect(props.prop).toBeDefined();
    expect(props.nota).toBeDefined();
    expect(props.secao).toBeDefined();
    expect(props.compacto).toBeDefined();
    expect(props.limite).toBeDefined();

    // Removed legacy clutter
    expect(props.acao).toBeUndefined();
    expect(props.pasta).toBeUndefined();
    expect(props.extensao).toBeUndefined();
    expect(props.recursivo).toBeUndefined();
    expect(props.cabecalho).toBeUndefined();
  });

  it("marks list_folders and list_files as exposicao: 'indice'", () => {
    const listFolders = tools.find((t) => t.name === "list_folders")!;
    expect(listFolders.exposicao).toBe("indice");

    const listFiles = tools.find((t) => t.name === "list_files")!;
    expect(listFiles.exposicao).toBe("indice");
  });

  it("syncs all 8 tools to toolIndex with expected shape", async () => {
    const syncMock = vi.fn().mockResolvedValue(undefined);
    const mockApi = {
      toolIndex: {
        sync: syncMock,
      },
    } as unknown as AIEcosystemAPI;

    const entries: ToolIndexEntry[] = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      categoria: t.categoria,
      tags: t.tags,
      resumo: t.resumo,
      efeito: t.efeito,
      exposicao: t.exposicao,
      aprovacao: t.aprovacao,
      exemplo: t.exemplo,
    }));

    await mockApi.toolIndex?.sync("ai-vault-search", entries);

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledWith("ai-vault-search", expect.arrayContaining([
      expect.objectContaining({ name: "search", exposicao: "fixa", efeito: "leitura" }),
      expect.objectContaining({ name: "find", exposicao: "fixa", efeito: "leitura" }),
      expect.objectContaining({ name: "search_notes", exposicao: "indice", efeito: "leitura" }),
      expect.objectContaining({ name: "get_section", exposicao: "fixa", efeito: "leitura" }),
      expect.objectContaining({ name: "list_folders", exposicao: "indice", efeito: "leitura" }),
      expect.objectContaining({ name: "list_files", exposicao: "indice", efeito: "leitura" }),
      expect.objectContaining({ name: "read_table", exposicao: "fixa", efeito: "leitura" }),
    ]));
  });
});
