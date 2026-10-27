import { describe, expect, it, vi } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchResultPayload } from "../src/search/types";
import { fakeVault } from "./helpers/fake-vault";

function caminhos(res: SearchResultPayload): string[] {
  return res.resultados.map((r) => r.caminho).sort();
}

describe("busca pelo índice BM25", () => {
  it("(1) nota com o termo no título vem antes da que tem o termo só no corpo", async () => {
    const app = fakeVault([
      { path: "Corpo.md", content: "# Outra\nlinha alvo\n" },
      { path: "Alvo.md", content: "# Título\nlinha neutra\n" },
    ]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["alvo"] });

    expect(res.resultados.map((r) => r.nome)).toEqual(["Alvo", "Corpo"]);
  });

  it("(2) segunda busca idêntica relê no máximo a página (cofre sem mudanças)", async () => {
    const notas = Array.from({ length: 300 }, (_, i) => ({
      path: `Notas/n${i}.md`,
      content: `# N${i}\nalvo ${i}\n`,
    }));
    const app = fakeVault(notas);
    const engine = new VaultSearchEngine(app);
    const spy = vi.spyOn(app.vault, "cachedRead");

    await engine.search({ termos: ["alvo"] });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(300);

    spy.mockClear();
    await engine.search({ termos: ["alvo"] });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("(3) nota alterada (mtime novo) é achada pelo termo novo e perde o antigo", async () => {
    const alvoPath = "Notas/Mut.md";
    const app = fakeVault([
      { path: alvoPath, content: "# Mut\nlinha velha antigo\n" },
      { path: "Notas/Outra.md", content: "# Outra\nlinha outra\n" },
    ]);
    const engine = new VaultSearchEngine(app);
    const caminhosDe = async (termo: string) => caminhos(await engine.search({ termos: [termo] }));

    expect(await caminhosDe("antigo")).toEqual([alvoPath]);

    const original = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, "cachedRead").mockImplementation(async (f) =>
      f.path === alvoPath ? "texto novo zzz\n" : original(f),
    );
    const arquivo = app.vault.getMarkdownFiles().find((f) => f.path === alvoPath)!;
    arquivo.stat.mtime += 1;

    expect(await caminhosDe("zzz")).toEqual([alvoPath]);
    expect(await caminhosDe("antigo")).toEqual([]);
  });

  it("(4) nota que sai da lista de visíveis sai dos resultados", async () => {
    const app = fakeVault([
      { path: "Publica/a.md", content: "# A\nalvo\n" },
      { path: "Privada/b.md", content: "# B\nalvo\n" },
    ]);
    const engine = new VaultSearchEngine(app);
    expect(caminhos(await engine.search({ termos: ["alvo"] }))).toEqual(["Privada/b.md", "Publica/a.md"]);

    engine.setExcludedFolders(["Privada"]);

    expect(caminhos(await engine.search({ termos: ["alvo"] }))).toEqual(["Publica/a.md"]);
  });

  it("(5) total reflete todos os resultados e limite só corta a página", async () => {
    const notas = Array.from({ length: 25 }, (_, i) => ({ path: `Lote/n${i}.md`, content: `# N${i}\nalvo\n` }));
    const engine = new VaultSearchEngine(fakeVault(notas));

    const res = await engine.search({ termos: ["alvo"], limite: 10 });

    expect(res.total).toBe(25);
    expect(res.resultados).toHaveLength(10);
  });
});
