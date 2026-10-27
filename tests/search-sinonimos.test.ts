import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

function criarMotor() {
  const app = fakeVault([
    { path: "A.md", content: "tratamos a automacao do processo" },
    { path: "B.md", content: "o fluxo principal" },
    { path: "C.md", content: "vários fluxos paralelos" },
  ]);
  return new VaultSearchEngine(app);
}

function nomes(r: { resultados: { nome: string }[] }): string[] {
  return r.resultados.map((x) => x.nome).sort();
}

describe("search sem sinonimos por padrao (motor)", () => {
  it("padrao: 'fluxo' nao acha a nota que so tem 'automacao'", async () => {
    const r = await criarMotor().search({ termos: ["fluxo"] });
    expect(nomes(r)).toEqual(["B", "C"]);
  });

  it("sinonimos: true: 'fluxo' acha tambem a nota de 'automacao'", async () => {
    const r = await criarMotor().search({ termos: ["fluxo"], sinonimos: true });
    expect(nomes(r)).toEqual(["A", "B", "C"]);
  });

  it("exato: true: 'fluxo' nao casa 'fluxos'", async () => {
    const r = await criarMotor().search({ termos: ["fluxo"], exato: true });
    expect(nomes(r)).toEqual(["B"]);
  });

  it("exato: true com sinonimos: true: exato desliga os sinonimos", async () => {
    const r = await criarMotor().search({ termos: ["fluxo"], exato: true, sinonimos: true });
    expect(nomes(r)).toEqual(["B"]);
  });

  it("sem exato, 'flux' casa por trecho de palavra em 'fluxo' e 'fluxos'", async () => {
    const r = await criarMotor().search({ termos: ["flux"] });
    expect(nomes(r)).toEqual(["B", "C"]);
  });
});

describe("tool search expoe sinonimos e exato", () => {
  function chamarSearch(args: Record<string, unknown>) {
    const app = fakeVault([
      { path: "A.md", content: "tratamos a automacao do processo" },
      { path: "B.md", content: "o fluxo principal" },
      { path: "C.md", content: "vários fluxos paralelos" },
    ]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));
    const search = tools.find((t) => t.name === "search")!;
    return search.handler(args, {} as never).then((res) => {
      const bloco = res.content[0];
      if (bloco.type !== "text") throw new Error("resposta sem texto");
      return JSON.parse(bloco.text);
    });
  }

  it("sem opcoes, 'fluxo' devolve total 2 (B e C)", async () => {
    const r = await chamarSearch({ termos: ["fluxo"] });
    expect(r.total).toBe(2);
  });

  it("com sinonimos: true, 'fluxo' devolve total 3", async () => {
    const r = await chamarSearch({ termos: ["fluxo"], sinonimos: true });
    expect(r.total).toBe(3);
  });

  it("com exato: true, 'fluxo' devolve total 1", async () => {
    const r = await chamarSearch({ termos: ["fluxo"], exato: true });
    expect(r.total).toBe(1);
  });

  it("o schema da tool search tem os parametros sinonimos e exato", () => {
    const app = fakeVault([]);
    const search = createSearchTools(app, new VaultSearchEngine(app)).find((t) => t.name === "search")!;
    const props = search.inputSchema.properties as Record<string, { type: string; default?: unknown }>;
    expect(props.sinonimos).toBeDefined();
    expect(props.sinonimos.type).toBe("boolean");
    expect(props.sinonimos.default).toBe(false);
    expect(props.exato).toBeDefined();
    expect(props.exato.type).toBe("boolean");
    expect(props.exato.default).toBe(false);
  });
});
