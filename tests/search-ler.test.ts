import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

const NOTAS = [
  {
    path: "Notas/Acesso Fluxo.md",
    content: "# Fluxo\n## Passos\nfaca o acesso ao jira\ndepois confira\n## Outra\ntexto de outra secao\n",
  },
  { path: "Notas/Outra.md", content: "# Outra\nacesso no corpo\n" },
];

describe("search com ler: seção que casou no primeiro resultado", () => {
  const app = fakeVault(NOTAS);
  const engine = new VaultSearchEngine(app);

  it("traz só a seção do primeiro resultado quando ler é true", async () => {
    const res = await engine.search({ termos: ["acesso"], ler: true });
    const primeiro = res.resultados[0];
    expect(primeiro.nome).toBe("Acesso Fluxo");
    expect(primeiro.conteudo).toContain("faca o acesso ao jira");
    expect(primeiro.conteudo).toContain("depois confira");
    expect(primeiro.conteudo).not.toContain("texto de outra secao");
    expect(primeiro.secao_titulo).toBe("Passos");
    expect(res.resultados[1].conteudo).toBeUndefined();
  });

  it("não devolve conteudo quando ler não é pedido", async () => {
    const res = await engine.search({ termos: ["acesso"] });
    expect(res.resultados.length).toBeGreaterThan(0);
    for (const r of res.resultados) {
      expect(r.conteudo).toBeUndefined();
    }
  });
});

describe("search com ler: seção maior que o limite", () => {
  const app = fakeVault([
    { path: "Notas/Big.md", content: "# Big\n## Grande\nacesso " + "x".repeat(6000) + "\n" },
  ]);
  const engine = new VaultSearchEngine(app);

  it("trunca a seção e avisa para usar get_section", async () => {
    const res = await engine.search({ termos: ["acesso"], ler: true });
    const conteudo = res.resultados[0].conteudo!;
    expect(conteudo.endsWith("use get_section para o restante]")).toBe(true);
    expect(conteudo.length).toBeLessThanOrEqual(4100);
  });
});

describe("search tool: ler", () => {
  const app = fakeVault(NOTAS);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const search = tools.find((t) => t.name === "search")!;

  it("com ler: true, o primeiro resultado traz a seção", async () => {
    const res = await search.handler({ termos: ["acesso"], ler: true }, {} as never);
    const json = JSON.parse((res.content[0] as { text: string }).text) as { resultados: { conteudo?: string }[] };
    expect(json.resultados[0].conteudo).toContain("faca o acesso ao jira");
  });

  it("sem ler, nenhum resultado traz conteudo", async () => {
    const res = await search.handler({ termos: ["acesso"] }, {} as never);
    const json = JSON.parse((res.content[0] as { text: string }).text) as { resultados: { conteudo?: string }[] };
    expect(json.resultados.every((r) => r.conteudo === undefined)).toBe(true);
  });

  it("o schema declara ler como boolean", () => {
    const props = search.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.ler).toBeDefined();
    expect(props.ler.type).toBe("boolean");
  });
});
