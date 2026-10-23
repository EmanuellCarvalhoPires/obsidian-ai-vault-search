import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { compact, jsonResult } from "../src/tools/format";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

const notes = [
  { path: "MOC - Tools.md", content: "---\ntags: [moc]\n---\n# MOC\n" },
  { path: "Fluxos/Cat.md", content: '---\ntags: [automacao]\nup: "[[MOC - Tools]]"\n---\n# Cat\n' },
  { path: "Fluxos/Fluxo A.md", content: '---\ntags: [automacao]\nup: "[[Cat]]"\n---\n# A\n## Passos\nacesso ao jira\n' },
];

function setup() {
  const app = fakeVault(notes, ["Anexos/a.png"]);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await tools.find((t) => t.name === name)!.handler(args, {} as never);
    const first = res.content[0];
    const text = first.type === "text" ? first.text : "";
    return { res, text, json: JSON.parse(text) as Record<string, any> };
  };
  return { call };
}

describe("compact output", () => {
  it("drops undefined, null, empty strings/arrays/objects but keeps 0 and false", () => {
    expect(compact({ a: undefined, b: null, c: "", d: [], e: {}, f: 0, g: false, h: [{ x: "" , y: 1 }] })).toEqual({
      f: 0,
      g: false,
      h: [{ y: 1 }],
    });
  });

  it("keeps total and resultados at the top level even when empty", () => {
    expect(compact({ total: 0, resultados: [], dicas: [] }, true)).toEqual({ total: 0, resultados: [] });
  });

  it("jsonResult emits one compact text and no structuredContent", () => {
    const r = jsonResult({ total: 1, resultados: [{ nome: "x" }] });
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("\\n");
  });
});

describe("tool responses", () => {
  it("search_notes: no indentation, no structuredContent, no empty fields", async () => {
    const { call } = setup();
    const { res, text, json } = await call("search_notes", { termos: ["acesso"] });
    expect(res.structuredContent).toBeUndefined();
    expect(text).not.toContain("\n");
    expect(text).not.toContain('""');
    expect(json.total).toBe(1);
    expect(json.resultados[0].caminho).toBe("Fluxos/Fluxo A.md");
    expect(json.resultados[0].pontos).toBeGreaterThan(0);
  });

  it("unranked results carry no constant pontos", async () => {
    const { call } = setup();
    const { json } = await call("search_notes", { filhas: "MOC - Tools" });
    expect(json.resultados.map((r: any) => r.nome)).toEqual(["Cat"]);
    expect(json.resultados[0].pontos).toBeUndefined();
  });

  it("list_folders / list_files / get_section drop pontos:100 and empty modificada", async () => {
    const { call } = setup();
    const folders = await call("list_folders", { recursivo: true });
    expect(folders.text).not.toContain("pontos");
    expect(folders.text).not.toContain("modificada");
    const files = await call("list_files", { extensao: "md", recursivo: true });
    expect(files.text).not.toContain("pontos");
    expect(files.json.total).toBe(3);
    const sec = await call("get_section", { nota: "Fluxo A", cabecalho: "Passos" });
    expect(sec.text).not.toContain("pontos");
    expect(sec.json.resultados[0].conteudo).toContain("acesso ao jira");
  });

  it("empty result keeps total and resultados", async () => {
    const { call } = setup();
    const { json } = await call("search_notes", { termos: ["inexistente"] });
    expect(json.total).toBe(0);
    expect(json.resultados).toEqual([]);
  });
});
