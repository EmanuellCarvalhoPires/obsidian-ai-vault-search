import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

const NOTAS = Array.from({ length: 25 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    path: `N${n}.md`,
    content: `---\ntags: [automacao]\n---\nTexto com alvo.\n`,
  };
});

function motor(): VaultSearchEngine {
  return new VaultSearchEngine(fakeVault(NOTAS));
}

describe("search com limite e restantes", () => {
  it("primeira página de 10 de 25 traz restantes 15", async () => {
    const r = await motor().search({ termos: ["alvo"], limite: 10 });
    expect(r.total).toBe(25);
    expect(r.resultados).toHaveLength(10);
    expect(r.restantes).toBe(15);
  });

  it("offset 10 traz os 10 seguintes e restantes 5", async () => {
    const primeira = await motor().search({ termos: ["alvo"], limite: 10 });
    const segunda = await motor().search({ termos: ["alvo"], limite: 10, offset: 10 });
    expect(segunda.resultados).toHaveLength(10);
    const nomesPrimeira = new Set(primeira.resultados.map((x) => x.nome));
    expect(segunda.resultados.some((x) => nomesPrimeira.has(x.nome))).toBe(false);
    expect(segunda.restantes).toBe(5);
  });

  it("offset 20 traz as 5 últimas e não informa restantes", async () => {
    const r = await motor().search({ termos: ["alvo"], limite: 10, offset: 20 });
    expect(r.resultados).toHaveLength(5);
    expect(r.restantes).toBeUndefined();
  });

  it("offset além do total não devolve resultados", async () => {
    const r = await motor().search({ termos: ["alvo"], limite: 10, offset: 30 });
    expect(r.resultados).toHaveLength(0);
    expect(r.total).toBe(25);
  });
});

describe("search com dicas quando vazio", () => {
  it("tag digitada errada sugere a tag parecida", async () => {
    const r = await motor().search({ tag: "autmacao" });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Tags parecidas");
    expect(r.dicas?.[0]).toContain("automacao");
  });

  it("termos sem resultado sugerem menos termos ou sinonimos", async () => {
    const r = await motor().search({ termos: ["inexistentezzz"] });
    expect(r.dicas?.[0].startsWith("Nenhuma nota casou")).toBe(true);
    expect(r.dicas?.[0]).toContain("sinonimos: true");
  });

  it("não há dicas quando há resultados", async () => {
    const r = await motor().search({ termos: ["alvo"] });
    expect(r.total).toBe(25);
    expect(r.dicas).toBeUndefined();
  });
});

describe("findNotes com offset e dicas", () => {
  it("offset 5 com limite 5 traz 5 resultados e restantes 15", async () => {
    const r = await motor().findNotes({ query: "N", limite: 5, offset: 5 });
    expect(r.resultados).toHaveLength(5);
    expect(r.restantes).toBe(15);
  });

  it("consulta sem nenhum casamento devolve a dica de nome", async () => {
    const r = await motor().findNotes({ query: "zzzz" });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Nenhum arquivo com 'zzzz'");
  });
});
