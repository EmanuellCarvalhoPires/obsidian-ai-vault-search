import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { isExcluded, largestFolders, normalizeFolders } from "../src/search/exclusion";
import { VaultSearchEngine } from "../src/search/search-engine";
import { loadSettings } from "../src/settings";
import { createSetupHandler, publishExcludedFolders } from "../src/setup/setup-handler";

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  f.extension = f.name.includes(".") ? (f.name.split(".").pop() ?? "") : "";
  f.basename = f.name.replace(/\.[^.]+$/, "");
  f.stat = { ctime: 1, mtime: 1, size: 1 };
  return f;
}

function fakeApp(paths: string[]): App {
  const files = paths.map(file);
  return {
    vault: {
      getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
      getFiles: () => files,
      getAllLoadedFiles: () => [],
      getAbstractFileByPath: () => null,
      cachedRead: async () => "",
    },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
}

describe("exclusion filter", () => {
  it("normalizes the list", () => {
    expect(normalizeFolders([" Anexos/ ", "Arquivo\\Velho", "./MCP//Tools", "", ".", 3, "Anexos"])).toEqual([
      "Anexos",
      "Arquivo/Velho",
      "MCP/Tools",
    ]);
    expect(normalizeFolders("x")).toEqual([]);
  });

  it("excludes the folder and what is inside it, by whole segment", () => {
    const folders = ["Anexos", "MCP/Tools"];
    expect(isExcluded("Anexos/a.png", folders)).toBe(true);
    expect(isExcluded("Anexos", folders)).toBe(true);
    expect(isExcluded("MCP/Tools/x/y.md", folders)).toBe(true);
    expect(isExcluded("Anexos2/a.md", folders)).toBe(false);
    expect(isExcluded("MCP/Requests/a.md", folders)).toBe(false);
    expect(isExcluded("Notas/Anexos/a.md", folders)).toBe(false);
  });

  it("ignores letter case, since the disk does on Windows", () => {
    const folders = ["Arquivo"];
    expect(isExcluded("arquivo/x.md", folders)).toBe(true);
    expect(isExcluded("ARQUIVO/x.md", folders)).toBe(true);
    expect(isExcluded("arquivo", folders)).toBe(true);
    expect(isExcluded("Arquivo2/x.md", folders)).toBe(false);
    expect(isExcluded("Notas/Arquivo/x.md", folders)).toBe(false);
  });

  it("suggests the largest folders without repeating parents or excluded ones", () => {
    const paths = [
      ...Array.from({ length: 5 }, (_, i) => `Anexos/img${i}.png`),
      ...Array.from({ length: 3 }, (_, i) => `MCP/Tools/t${i}.md`),
      "MCP/Requests/r.md",
      "Notas/a.md",
      "root.md",
    ];
    expect(largestFolders(paths, 8)).toEqual([
      { pasta: "Anexos", arquivos: 5 },
      { pasta: "MCP", arquivos: 4 },
      { pasta: "MCP/Tools", arquivos: 3 },
      { pasta: "MCP/Requests", arquivos: 1 },
      { pasta: "Notas", arquivos: 1 },
    ]);
    expect(largestFolders(paths, 2)).toHaveLength(2);
    expect(largestFolders(paths, 8, ["Anexos"]).some((f) => f.pasta === "Anexos")).toBe(false);
  });

  it("loads the setting defensively", () => {
    expect(loadSettings(null)).toEqual({ pastasForaDoIndice: [] });
    expect(loadSettings({ pastasForaDoIndice: ["A/", 1] })).toEqual({ pastasForaDoIndice: ["A"] });
  });
});

describe("engine with excluded folders", () => {
  const paths = ["Notas/a.md", "Anexos/b.md", "Anexos/c.png", "Anexos/sub/d.md", "Anexos2/e.md"];

  it("leaves excluded folders out of status, listing and search", async () => {
    const engine = new VaultSearchEngine(fakeApp(paths));
    expect(engine.getIndexedNotes()).toHaveLength(5 - 1);
    engine.setExcludedFolders(["Anexos"]);

    expect(engine.getIndexedNotes().map((f) => f.path)).toEqual(["Notas/a.md", "Anexos2/e.md"]);
    const status = await engine.search({ acao: "status" });
    expect(status.estatisticas?.total_notas).toBe(2);

    const list = await engine.search({ acao: "listar_arquivos", extensao: "*" });
    expect(list.resultados.map((r) => r.caminho).sort()).toEqual(["Anexos2/e.md", "Notas/a.md"]);

    const section = await engine.search({ acao: "obter_secao", nota: "b" });
    expect(section.total).toBe(0);

    engine.setExcludedFolders([]);
    expect(engine.getIndexedNotes()).toHaveLength(4);
  });
});

describe("rule data", () => {
  it("publishes the excluded folders and tolerates a missing hooks service", () => {
    const setRuleData = vi.fn();
    publishExcludedFolders({ setRuleData, registerSetupHandler: () => () => {}, getModuleState: () => undefined }, "ai-vault-search", ["Anexos"]);
    expect(setRuleData).toHaveBeenCalledWith("ai-vault-search", { excludedFolders: ["Anexos"] });
    expect(() => publishExcludedFolders(undefined, "ai-vault-search", [])).not.toThrow();
  });
});

describe("setup handler", () => {
  function handler(initial: string[] = []) {
    let excluded = initial;
    const setExcludedFolders = vi.fn(async (folders: string[]) => {
      excluded = folders;
    });
    const all = ["Anexos/a.png", "Anexos/b.png", "Notas/n.md"];
    const h = createSetupHandler({
      indexedNotePaths: () => ["Notas/n.md"],
      allFilePaths: () => all,
      getExcludedFolders: () => excluded,
      setExcludedFolders,
    });
    return { h, setExcludedFolders, get: () => excluded };
  }

  it("detects note count, largest folders and excluded folders", async () => {
    const { h } = handler(["Arquivo"]);
    expect(await h.detect!()).toEqual({
      noteCount: 1,
      largestFolders: [
        { pasta: "Anexos", arquivos: 2 },
        { pasta: "Notas", arquivos: 1 },
      ],
      excludedFolders: ["Arquivo"],
    });
  });

  it("saves pastas_fora_do_indice normalized", async () => {
    const { h, setExcludedFolders, get } = handler();
    expect(await h.save!("pastas_fora_do_indice", ["Anexos/", "Anexos", "MCP/Tools"])).toBeUndefined();
    expect(setExcludedFolders).toHaveBeenCalledOnce();
    expect(get()).toEqual(["Anexos", "MCP/Tools"]);
    expect(await h.save!("pastas_fora_do_indice", [])).toBeUndefined();
    expect(get()).toEqual([]);
  });

  it("refuses bad values and unknown keys", async () => {
    const { h, setExcludedFolders } = handler();
    expect(typeof (await h.save!("pastas_fora_do_indice", "Anexos"))).toBe("string");
    expect(typeof (await h.save!("pastas_fora_do_indice", [1]))).toBe("string");
    expect(typeof (await h.save!("pastas_fora_do_indice", ["../fora"]))).toBe("string");
    expect(await h.save!("outra", 1)).toBe("Unknown key: outra");
    expect(setExcludedFolders).not.toHaveBeenCalled();
  });

  it("validates", async () => {
    expect(await handler().h.validate!()).toEqual({ ok: true });
  });
});
