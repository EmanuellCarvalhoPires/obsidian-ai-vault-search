import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchResultPayload } from "../src/search/types";
import { fakeVault } from "./helpers/fake-vault";

const X = "Knowledge/Referências do Cofre/X.md";
const L = "Knowledge/Logs/L.md";
const Y = "Arquivo/Y.md";
const Z = "Projetos/Z.md";

function motor(): VaultSearchEngine {
  const notas = [X, L, Y, Z].map((path) => ({ path, content: "Anotação sobre o plano." }));
  return new VaultSearchEngine(fakeVault(notas));
}

const caminhos = (r: SearchResultPayload): string[] => r.resultados.map((x) => x.caminho).sort();

describe("search respeita pasta", () => {
  it("pasta com acento devolve só a nota dessa pasta", async () => {
    const r = await motor().search({ termos: ["plano"], pasta: "Knowledge/Referências do Cofre" });
    expect(caminhos(r)).toEqual([X]);
  });

  it("pasta em minúsculas e com barra final devolve o mesmo resultado", async () => {
    const r = await motor().search({ termos: ["plano"], pasta: "knowledge/referências do cofre/" });
    expect(caminhos(r)).toEqual([X]);
  });

  it("pasta pai devolve as notas de todas as subpastas dela", async () => {
    const r = await motor().search({ termos: ["plano"], pasta: "Knowledge" });
    expect(caminhos(r)).toEqual([X, L].sort());
  });

  it("sem pasta, devolve as quatro notas", async () => {
    const r = await motor().search({ termos: ["plano"] });
    expect(caminhos(r)).toEqual([X, L, Y, Z].sort());
  });

  it("findNotes com pasta devolve só notas dentro dela", async () => {
    const r = await motor().findNotes({ query: "X", pasta: "Knowledge" });
    expect(caminhos(r)).toEqual([X]);
  });

  it("extensao pdf na busca padrao devolve total 0", async () => {
    const r = await motor().search({ termos: ["plano"], extensao: "pdf" });
    expect(r.total).toBe(0);
    expect(r.resultados).toHaveLength(0);
  });
});
