import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

const PLANO = {
  path: "Projetos/Plano.md",
  content:
    "---\nstatus: ativo\nresponsavel: Ana\ntags: [dev]\n---\n# Plano\n## Passos\nveja [[Outra Nota]] e [[Mais Uma]]\n## Fim\ntexto final longo\n",
};

describe("motor lerNota", () => {
  const app = fakeVault([PLANO]);
  const engine = new VaultSearchEngine(app);

  it("devolve frontmatter, esboço e links de saída em um só resultado", async () => {
    const res = await engine.lerNota({ nota: "Plano" });
    expect(res.total).toBe(1);
    const nota = res.resultados[0];
    expect(nota.frontmatter).toMatchObject({ status: "ativo", responsavel: "Ana" });
    expect(nota.frontmatter).not.toHaveProperty("position");
    expect(nota.outline).toHaveLength(3);
    expect(nota.outline!.map((h) => h.nivel)).toEqual([1, 2, 2]);
    expect(nota.outlinks).toEqual(["Outra Nota", "Mais Uma"]);
    expect(nota.corpo).toBeUndefined();
  });

  it("frontmatter com uma chave devolve só ela, sem diferenciar maiúsculas", async () => {
    const res = await engine.lerNota({ nota: "Plano", frontmatter: ["STATUS"] });
    expect(res.resultados[0].frontmatter).toEqual({ status: "ativo" });
  });

  it("lista vazia de frontmatter e outline e outlinks false não devolvem esses campos", async () => {
    const res = await engine.lerNota({ nota: "Plano", frontmatter: [], outline: false, outlinks: false });
    const nota = res.resultados[0];
    expect(nota.frontmatter).toBeUndefined();
    expect(nota.outline).toBeUndefined();
    expect(nota.outlinks).toBeUndefined();
  });

  it("corpo com limite corta em N caracteres a partir do corpo e marca truncado", async () => {
    const res = await engine.lerNota({ nota: "Plano", corpo: 20 });
    const nota = res.resultados[0];
    expect(nota.corpo).toHaveLength(20);
    expect(nota.corpo!.startsWith("# Plano")).toBe(true);
    expect(nota.corpo_truncado).toBe(true);
  });

  it("nota inexistente devolve total 0 com dica", async () => {
    const res = await engine.lerNota({ nota: "Inexistente" });
    expect(res.total).toBe(0);
    expect(res.resultados).toHaveLength(0);
    expect(res.dicas?.[0]).toContain("Nota não encontrada");
  });
});

describe("get_note tool", () => {
  const app = fakeVault([PLANO]);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const getNote = tools.find((t) => t.name === "get_note")!;

  it("com nota devolve frontmatter, outline e outlinks, sem consulta", async () => {
    const res = await getNote.handler({ nota: "Plano" }, {} as never);
    const json = JSON.parse((res.content[0] as { text: string }).text) as Record<string, any>;
    expect(json.resultados[0].frontmatter.status).toBe("ativo");
    expect(json.resultados[0].outline).toHaveLength(3);
    expect(json.resultados[0].outlinks).toEqual(["Outra Nota", "Mais Uma"]);
    expect(json.consulta).toBeUndefined();
  });

  it("sem nota devolve erro", async () => {
    const res = await getNote.handler({}, {} as never);
    expect(res.isError).toBe(true);
  });
});
