import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

const app = fakeVault([
  { path: "MCP/Tools/a.md", content: "# A\n" },
  { path: "Projetos/Teste/b.md", content: "# B\n" },
  { path: "Knowledge/Logs/c.md", content: "# C\n" },
]);

const engine = new VaultSearchEngine(app);

const caminhos = (r: { resultados: { caminho?: string }[] }) => r.resultados.map((x) => x.caminho);

describe("listar_pastas com caixa e barra diferentes", () => {
  it("'mcp/' acha a pasta MCP e lista suas subpastas", async () => {
    const r = await engine.search({ acao: "listar_pastas", pasta: "mcp/" });
    expect(r.total).toBeGreaterThan(0);
    expect(caminhos(r)).toContain("MCP/Tools");
  });

  it("pasta inexistente devolve total 0 e sugere a parecida", async () => {
    const r = await engine.search({ acao: "listar_pastas", pasta: "Projeto" });
    expect(r.total).toBe(0);
    expect(r.resultados).toEqual([]);
    const dica = (r.dicas ?? []).join("\n");
    expect(dica).toContain("Pasta não encontrada");
    expect(dica).toContain("Parecidas:");
    expect(dica).toContain("Projetos");
  });

  it("pasta vazia continua listando as pastas da raiz", async () => {
    const r = await engine.search({ acao: "listar_pastas", pasta: "" });
    expect(caminhos(r).sort()).toEqual(["Knowledge", "MCP", "Projetos"]);
    expect(r.dicas).toBeUndefined();
  });
});

describe("listar_arquivos com pasta resolvida ou inexistente", () => {
  it("'projetos/teste' acha a pasta sem diferenciar caixa e lista o arquivo", async () => {
    const r = await engine.search({ acao: "listar_arquivos", pasta: "projetos/teste" });
    expect(caminhos(r)).toContain("Projetos/Teste/b.md");
    expect(r.dicas).toBeUndefined();
  });

  it("pasta inexistente devolve total 0 e dica", async () => {
    const r = await engine.search({ acao: "listar_arquivos", pasta: "Zzz" });
    expect(r.total).toBe(0);
    expect(r.resultados).toEqual([]);
    expect((r.dicas ?? []).join("\n")).toContain("Pasta não encontrada: Zzz");
  });

  it("pasta existente sem arquivos da extensão explica e sugere extensao '*' ou recursivo", async () => {
    const r = await engine.search({ acao: "listar_arquivos", pasta: "Projetos", extensao: "md", recursivo: false });
    expect(r.total).toBe(0);
    const dica = (r.dicas ?? []).join("\n");
    expect(dica).toContain("A pasta existe");
    expect(dica).toContain('extensao: "*" ou recursivo: true');
  });

  it("pasta vazia continua listando como antes", async () => {
    const r = await engine.search({ acao: "listar_arquivos", pasta: "", extensao: "md" });
    expect(r.total).toBe(3);
    expect(r.dicas).toBeUndefined();
  });
});

describe("listar_arquivos na raiz com pasta '/'", () => {
  const appRaiz = fakeVault([
    { path: "r1.md", content: "# R1\n" },
    { path: "r2.md", content: "# R2\n" },
    { path: "Sub/s1.md", content: "# S1\n" },
  ]);
  const motor = new VaultSearchEngine(appRaiz);

  it("sem recursivo lista só os arquivos da raiz", async () => {
    const r = await motor.search({ acao: "listar_arquivos", pasta: "/" });
    expect(caminhos(r).sort()).toEqual(["r1.md", "r2.md"]);
  });

  it("com recursivo lista tudo", async () => {
    const r = await motor.search({ acao: "listar_arquivos", pasta: "/", recursivo: true });
    expect(caminhos(r).sort()).toEqual(["Sub/s1.md", "r1.md", "r2.md"]);
  });
});
