import { describe, expect, it, vi } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchResultPayload } from "../src/search/types";
import { fakeVault } from "./helpers/fake-vault";

function caminhos(res: SearchResultPayload): string[] {
  return res.resultados.map((r) => r.caminho).sort();
}

describe("eventos do Obsidian mantêm o índice", () => {
  it("(1) aquecerIndice lê cada nota uma vez; a busca seguinte só relê a página", async () => {
    const notas = Array.from({ length: 30 }, (_, i) => ({ path: `Lote/n${i}.md`, content: `# N${i}\nalvo\n` }));
    const app = fakeVault(notas);
    const engine = new VaultSearchEngine(app);
    const spy = vi.spyOn(app.vault, "cachedRead");

    await engine.aquecerIndice();
    expect(spy.mock.calls.length).toBe(30);

    spy.mockClear();
    const res = await engine.search({ termos: ["alvo"], limite: 5 });
    expect(res.total).toBe(30);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("(2) invalidarNota faz a busca seguinte reler só essa nota e achar o termo novo", async () => {
    const alvoPath = "Notas/Mut.md";
    const app = fakeVault([
      { path: alvoPath, content: "# Mut\nlinha velha\n" },
      { path: "Notas/Outra.md", content: "# Outra\nlinha outra\n" },
    ]);
    const engine = new VaultSearchEngine(app);
    const caminhosDe = async (termo: string) => caminhos(await engine.search({ termos: [termo] }));
    expect(await caminhosDe("velha")).toEqual([alvoPath]);

    // Conteúdo muda sem mudar mtime: só o evento faz o índice reler a nota.
    const original = app.vault.cachedRead.bind(app.vault);
    let alterado = false;
    const spy = vi
      .spyOn(app.vault, "cachedRead")
      .mockImplementation(async (f) => (alterado && f.path === alvoPath ? "texto novo zzz\n" : original(f)));
    alterado = true;
    expect(await caminhosDe("zzz")).toEqual([]);

    spy.mockClear();
    engine.invalidarNota(alvoPath);
    expect(await caminhosDe("zzz")).toEqual([alvoPath]);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.every(([f]) => f.path === alvoPath)).toBe(true);
  });

  it("(3) após removerNota de nota ainda visível, a busca a reindexa e a acha; renomearNota não lança", async () => {
    const app = fakeVault([
      { path: "Notas/Mut.md", content: "# Mut\nalvo\n" },
      { path: "Notas/Outra.md", content: "# Outra\noutro\n" },
    ]);
    const engine = new VaultSearchEngine(app);
    expect(caminhos(await engine.search({ termos: ["alvo"] }))).toEqual(["Notas/Mut.md"]);

    expect(() => engine.removerNota("Notas/Mut.md")).not.toThrow();
    expect(caminhos(await engine.search({ termos: ["alvo"] }))).toEqual(["Notas/Mut.md"]);

    expect(() => engine.renomearNota("a.md", "b.md")).not.toThrow();
    expect(() => engine.renomearNota("Notas/Outra.md", "Notas/Outra2.md")).not.toThrow();
    expect(caminhos(await engine.search({ termos: ["alvo"] }))).toEqual(["Notas/Mut.md"]);
  });

  it("(4) aquecerIndice não lança com cofre vazio", async () => {
    const engine = new VaultSearchEngine(fakeVault([]));

    await expect(engine.aquecerIndice()).resolves.toBeUndefined();
    const res = await engine.search({ termos: ["alvo"] });
    expect(res.total).toBe(0);
    expect(res.resultados).toEqual([]);
  });
});
