import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

// Raiz -> Cat -> (A, C); A -> B -> Raiz (ciclo via up:); Solta fica fora da árvore.
function cofreArvore() {
  return fakeVault([
    { path: "Raiz.md", content: '---\nup: "[[B]]"\n---\n# Raiz\n' },
    { path: "Cat.md", content: '---\nup: "[[Raiz]]"\n---\n# Cat\n' },
    { path: "A.md", content: '---\nup: "[[Cat]]"\n---\n# A\n' },
    { path: "C.md", content: '---\nup: "[[Cat]]"\n---\n# C\n' },
    { path: "B.md", content: '---\nup: "[[A]]"\n---\n# B\n' },
    { path: "Solta.md", content: "# Solta\n" },
  ]);
}

const nomes = (r: { resultados: { nome: string }[] }) => r.resultados.map((x) => x.nome);

// Texto da resposta da tool (só blocos de texto).
const textoDe = (res: { content: { type: string; text?: string }[] }): string =>
  res.content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");

describe("search arvore (engine)", () => {
  it("lists only the descendants of the root, without looping on the cycle", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({ arvore: "Raiz" });

    expect(nomes(r)).toEqual(["A", "B", "C", "Cat"]);
    expect(r.total).toBe(4);
    expect(nomes(r)).not.toContain("Raiz");
    expect(nomes(r)).not.toContain("Solta");
  });

  it("profundidade 1 returns only the direct children", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({ arvore: "Raiz", profundidade: 1 });

    expect(nomes(r)).toEqual(["Cat"]);
    expect(r.total).toBe(1);
  });

  it("profundidade 2 returns the children and grandchildren", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({ arvore: "Raiz", profundidade: 2 });

    expect(nomes(r)).toEqual(["A", "C", "Cat"]);
    expect(r.total).toBe(3);
  });

  it("returns total 0 and a hint when the root note does not exist", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({ arvore: "Inexistente" });

    expect(r.total).toBe(0);
    expect(r.resultados).toEqual([]);
    expect(r.dicas?.[0].startsWith("Nota raiz não encontrada")).toBe(true);
  });

  it("returns total 0 and a hint asking for a criterion when no criterion is given", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({});

    expect(r.total).toBe(0);
    expect(r.resultados).toEqual([]);
    expect(r.dicas?.[0].startsWith("Informe ao menos um critério")).toBe(true);
  });

  it("combines arvore with other filters: a term that matches nothing gives total 0", async () => {
    const engine = new VaultSearchEngine(cofreArvore());
    const r = await engine.search({ arvore: "Raiz", termos: ["zzz"] });

    expect(r.total).toBe(0);
  });
});

describe("search tool: arvore", () => {
  const app = cofreArvore();
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const search = tools.find((t) => t.name === "search")!;

  it("returns only Cat with profundidade 1", async () => {
    const res = await search.handler({ arvore: "Raiz", profundidade: 1 }, {} as never);
    const json = JSON.parse(textoDe(res));

    expect(json.total).toBe(1);
    expect(json.resultados[0].caminho.endsWith("Cat.md")).toBe(true);
  });

  it("declares profundidade in the search schema as an integer", () => {
    const props = search.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.profundidade).toBeDefined();
    expect(props.profundidade.type).toBe("integer");
  });

  it("with no arguments returns total 0 and a hint asking for a criterion", async () => {
    const res = await search.handler({}, {} as never);
    const json = JSON.parse(textoDe(res));

    expect(json.total).toBe(0);
    expect(json.dicas[0].startsWith("Informe ao menos um critério")).toBe(true);
  });
});
