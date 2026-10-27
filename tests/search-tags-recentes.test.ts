import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

const app = fakeVault([
  {
    path: "Projetos/P1.md",
    content: "---\nstatus: ativo\nepico: PROJ-4\ntags: [dev, dev/api]\n---\n# P1\n",
    mtime: 1_700_000_003_000,
  },
  {
    path: "Projetos/P2.md",
    content: "---\nstatus: ativo\ntags: [dev]\n---\n# P2\n",
    mtime: 1_700_000_002_000,
  },
  {
    path: "Notas/N1.md",
    content: "---\nstatus: parado\nepico: PROJ-4\nurl: a=b\ntags: [ops]\n---\n# N1\n",
    mtime: 1_700_000_001_000,
  },
]);

const engine = new VaultSearchEngine(app);

const caminhos = (r: { resultados: { caminho: string }[] }) => r.resultados.map((x) => x.caminho);

describe("prop com várias condições", () => {
  it("prop com chave=valor e tag busca só notas que casam", async () => {
    const r = await engine.search({ prop: "status=ativo", tag: "dev" });
    expect(caminhos(r).sort()).toEqual(["Projetos/P1.md", "Projetos/P2.md"]);
  });

  it("lista de condições vale só se todas valerem", async () => {
    const r = await engine.search({ prop: ["status=ativo", "epico=PROJ-4"] });
    expect(caminhos(r)).toEqual(["Projetos/P1.md"]);
  });

  it("condição só com a chave devolve notas que têm a chave", async () => {
    const r = await engine.search({ prop: "epico" });
    expect(caminhos(r).sort()).toEqual(["Notas/N1.md", "Projetos/P1.md"]);
  });

  it("separa no primeiro '=' e mantém o restante como valor", async () => {
    const r = await engine.search({ prop: "url=a=b" });
    expect(caminhos(r)).toEqual(["Notas/N1.md"]);
  });
});

describe("listarTags", () => {
  it("conta as tags das notas e ordena por contagem e nome", () => {
    const r = engine.listarTags({});
    expect(r.total).toBe(3);
    expect(r.tags).toEqual([
      { tag: "dev", contagem: 2 },
      { tag: "dev/api", contagem: 1 },
      { tag: "ops", contagem: 1 },
    ]);
    expect(r.restantes).toBeUndefined();
  });

  it("filtra pelo prefixo", () => {
    const r = engine.listarTags({ prefixo: "dev" });
    expect(r.tags).toEqual([
      { tag: "dev", contagem: 2 },
      { tag: "dev/api", contagem: 1 },
    ]);
  });

  it("corta pelo limite e informa quantas sobraram", () => {
    const r = engine.listarTags({ limite: 1 });
    expect(r.tags).toEqual([{ tag: "dev", contagem: 2 }]);
    expect(r.total).toBe(3);
    expect(r.restantes).toBe(2);
  });
});

describe("notasRecentes", () => {
  it("devolve as notas mais recentes em ordem decrescente", () => {
    const r = engine.notasRecentes({ limite: 2 });
    expect(r.total).toBe(3);
    expect(caminhos(r)).toEqual(["Projetos/P1.md", "Projetos/P2.md"]);
  });

  it("filtra por pasta", () => {
    const r = engine.notasRecentes({ pasta: "Notas" });
    expect(caminhos(r)).toEqual(["Notas/N1.md"]);
  });

  it("filtra por tag", () => {
    const r = engine.notasRecentes({ tag: "ops" });
    expect(caminhos(r)).toEqual(["Notas/N1.md"]);
  });
});

describe("prop vazio não conta como critério nem filtra", () => {
  const appSemFm = fakeVault([{ path: "Soltas/Sem.md", content: "# Sem\nTexto com palavra zebra aqui.\n" }]);
  const motor = new VaultSearchEngine(appSemFm);

  it("prop: [] sozinho pede um critério", async () => {
    const r = await motor.search({ prop: [] });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toMatch(/^Informe ao menos um critério/);
  });

  it("prop: [] com termos não elimina nota sem frontmatter", async () => {
    const r = await motor.search({ prop: [], termos: ["zebra"] });
    expect(caminhos(r)).toEqual(["Soltas/Sem.md"]);
  });
});
