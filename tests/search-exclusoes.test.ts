import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchResultPayload } from "../src/search/types";
import { fakeVault } from "./helpers/fake-vault";

const notas = [
  { path: "MCP/Tools/t.md", content: "# T\nalvo\n" },
  { path: "Notas/n.md", content: "# N\nalvo\n" },
  { path: ".obsidian/x.md", content: "# X\nalvo\n" },
];

function caminhos(res: SearchResultPayload): string[] {
  return res.resultados.map((r) => r.caminho).sort();
}

describe("exclusões do índice", () => {
  it("sem configuração, MCP/Tools entra na busca e .obsidian continua fora", async () => {
    const engine = new VaultSearchEngine(fakeVault(notas));

    const res = await engine.search({ termos: ["alvo"] });

    expect(caminhos(res)).toEqual(["MCP/Tools/t.md", "Notas/n.md"]);
  });

  it("pasta configurada em setExcludedFolders sai da busca", async () => {
    const engine = new VaultSearchEngine(fakeVault(notas));
    engine.setExcludedFolders(["MCP/Tools"]);

    const res = await engine.search({ termos: ["alvo"] });

    expect(caminhos(res)).toEqual(["Notas/n.md"]);
  });
});
