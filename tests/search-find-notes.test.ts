import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

function motorCom(paths: string[]): VaultSearchEngine {
  return new VaultSearchEngine(fakeVault(paths.map((path) => ({ path, content: "" }))));
}

const comparativos = [
  "Comparativo de Eficiencia.md",
  "Eficiencia Comparativo.md",
  "relatorio de vendas.md",
  "Comparativo vendas.md",
];

describe("findNotes descarta baixa pontuacao quando ha casamento completo", () => {
  it("com 3 termos, mantem quem casou pelo menos metade e corta o de 1 termo", async () => {
    const r = await motorCom(comparativos).findNotes({ query: "Comparativo de Eficiencia" });
    expect(r.resultados.map((x) => x.nome).sort()).toEqual([
      "Comparativo de Eficiencia",
      "Eficiencia Comparativo",
    ]);
    expect(r.total).toBe(2);
  });

  it("com 'vendas' (casamento completo nas duas), devolve as duas que tem a palavra", async () => {
    const r = await motorCom(comparativos).findNotes({ query: "vendas" });
    expect(r.resultados.map((x) => x.nome).sort()).toEqual(["Comparativo vendas", "relatorio de vendas"]);
    expect(r.total).toBe(2);
  });

  it("sem nenhum casamento completo ('zzz vendas'), os parciais continuam aparecendo", async () => {
    const r = await motorCom(comparativos).findNotes({ query: "zzz vendas" });
    expect(r.resultados.map((x) => x.nome).sort()).toEqual(["Comparativo vendas", "relatorio de vendas"]);
    expect(r.total).toBe(2);
  });

  it("nome mais curto com a mesma palavra fica primeiro", async () => {
    const r = await motorCom(["Fluxo A.md", "Outro Fluxo Longo.md"]).findNotes({ query: "Fluxo" });
    expect(r.total).toBe(2);
    expect(r.resultados[0].nome).toBe("Fluxo A");
  });

  it("sem consulta, lista tudo pela data de modificacao mais recente primeiro", async () => {
    const r = await motorCom(comparativos).findNotes({ query: "", limite: 10 });
    expect(r.total).toBe(4);
    expect(r.resultados[0].nome).toBe("Comparativo vendas");
  });
});
