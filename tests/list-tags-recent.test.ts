import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

const app = fakeVault([
  {
    path: "Projetos/P1.md",
    content: "---\nstatus: ativo\nepico: PROJ-4\ntags: [dev, dev/api]\n---\n# P1\n",
    mtime: 1_700_000_003_000,
  },
  {
    path: "Projetos/P2.md",
    content: "---\nstatus: ativo\ntags: [dev]\n---\n# P2\n",
    mtime: 1_700_000_002_000,
  },
  {
    path: "Notas/N1.md",
    content: "---\nstatus: parado\nepico: PROJ-4\nurl: a=b\ntags: [ops]\n---\n# N1\n",
    mtime: 1_700_000_001_000,
  },
]);

const engine = new VaultSearchEngine(app);
const tools = createSearchTools(app, engine);

const chamar = async (nome: string, args: Record<string, unknown>) => {
  const tool = tools.find((t) => t.name === nome)!;
  const res = await tool.handler(args, {} as never);
  return JSON.parse((res.content[0] as { text: string }).text);
};

describe("tool list_tags", () => {
  it("devolve as tags com contagem, ordenadas", async () => {
    const r = await chamar("list_tags", {});
    expect(r.tags).toEqual([
      { tag: "dev", contagem: 2 },
      { tag: "dev/api", contagem: 1 },
      { tag: "ops", contagem: 1 },
    ]);
  });

  it("filtra pelo prefixo", async () => {
    const r = await chamar("list_tags", { prefixo: "dev" });
    expect(r.tags.map((t: { tag: string }) => t.tag)).toEqual(["dev", "dev/api"]);
  });

  it("limite 0 devolve todas as tags, inclusive acima de 50", async () => {
    const notas = Array.from({ length: 55 }, (_, i) => ({
      path: `Lote/n${i}.md`,
      content: `---\ntags: [t${i}]\n---\n# n${i}\n`,
      mtime: 1_700_000_000_000 + i,
    }));
    const motor = new VaultSearchEngine(fakeVault(notas));
    const ferramenta = createSearchTools(fakeVault(notas), motor).find((t) => t.name === "list_tags")!;
    const res = await ferramenta.handler({ limite: 0 }, {} as never);
    const r = JSON.parse((res.content[0] as { text: string }).text);
    expect(r.tags).toHaveLength(55);
    expect(r.restantes).toBeUndefined();
  });

  it("dá dica quando o prefixo não acha nenhuma tag", async () => {
    const r = await chamar("list_tags", { prefixo: "zzz" });
    expect(r.total).toBe(0);
    expect(r.dicas[0]).toContain("zzz");
  });
});

describe("tool recent_notes", () => {
  it("com limite 2 devolve as 2 mais recentes só com caminho e modificada", async () => {
    const r = await chamar("recent_notes", { limite: 2 });
    expect(r.total).toBe(3);
    expect(r.resultados).toHaveLength(2);
    for (const item of r.resultados) {
      expect(Object.keys(item).sort()).toEqual(["caminho", "modificada"]);
    }
    expect(r.resultados.map((x: { caminho: string }) => x.caminho)).toEqual([
      "Projetos/P1.md",
      "Projetos/P2.md",
    ]);
  });

  it("sem notas para o filtro devolve dica", async () => {
    const r = await chamar("recent_notes", { tag: "zzz" });
    expect(r.total).toBe(0);
    expect(r.dicas).toHaveLength(1);
  });
});

describe("search com prop em lista", () => {
  it("vale a conjunção das condições", async () => {
    const r = await chamar("search", { prop: ["status=ativo", "epico=PROJ-4"], compacto: false });
    expect(r.resultados.map((x: { caminho: string }) => x.caminho)).toEqual(["Projetos/P1.md"]);
  });
});

describe("conjunto de tools", () => {
  it("lista as 9 tools na ordem indicada", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "search",
      "find",
      "list_folders",
      "list_files",
      "list_tags",
      "recent_notes",
      "get_section",
      "get_note",
      "read_table",
    ]);
  });
});
