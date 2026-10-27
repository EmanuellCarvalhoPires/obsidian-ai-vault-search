import { describe, expect, it } from "vitest";
import { VaultSearchEngine, linhaSoLinks } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

describe("trecho e detalhe do motor de busca", () => {
  const conteudo = "# A\n## Passos\n" + "acesso " + "x".repeat(250) + "\n";

  it("padrão: trecho de 120 caracteres e sem trecho de seção", async () => {
    const app = fakeVault([{ path: "Notas/A.md", content: conteudo }]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["acesso"], secao: true });
    const r = res.resultados[0];

    expect(r.trecho?.length).toBe(120);
    expect(r.secao_trecho).toBeUndefined();
    expect(r.secao_titulo).toBe("Passos");
  });

  it("detalhe: true devolve trecho de 200 caracteres e trecho de seção de até 300", async () => {
    const app = fakeVault([{ path: "Notas/A.md", content: conteudo }]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["acesso"], secao: true, detalhe: true });
    const r = res.resultados[0];

    expect(r.trecho?.length).toBe(200);
    expect(r.secao_trecho).toBeDefined();
    expect(r.secao_trecho!.length).toBeLessThanOrEqual(300);
  });
});

describe("trecho limpo, linha com mais termos e seção", () => {
  it("linhaSoLinks reconhece linhas que são só links", () => {
    expect(linhaSoLinks("- [[A]] | [[B]]")).toBe(true);
    expect(linhaSoLinks("veja [[A]] agora")).toBe(false);
    expect(linhaSoLinks("sem links")).toBe(false);
    expect(linhaSoLinks("- [x](http://a)")).toBe(true);
  });

  it("trecho não traz \\r de quebras CRLF", async () => {
    const app = fakeVault([
      {
        path: "Log.md",
        content: "# Log\r\n## Sumario\r\n- [[Log A]] | [[Log B]]\r\n## Corpo\r\nlinha real com acesso\r\n",
      },
    ]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["acesso"] });
    expect(res.resultados[0].trecho).toBe("linha real com acesso");
    expect(res.resultados[0].trecho).not.toContain("\r");
  });

  it("pula a linha só de wikilinks e usa a linha de texto", async () => {
    const app = fakeVault([
      { path: "Doc.md", content: "# Doc\n- [[Guia de acesso]] | [[Outro acesso]]\ntexto real sobre acesso\n" },
    ]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["acesso"] });
    expect(res.resultados[0].trecho).toBe("texto real sobre acesso");
  });

  it("omite a seção quando ela tem o nome da nota", async () => {
    const app = fakeVault([
      { path: "Projeto X.md", content: "# Projeto X\nacesso aqui\n" },
      { path: "Outra/Projeto Y.md", content: "# Projeto Y\n## Detalhe\nacesso aqui\n" },
    ]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ termos: ["acesso"], secao: true });
    const porNome = Object.fromEntries(res.resultados.map((r) => [r.nome, r]));
    expect(porNome["Projeto X"].secao_titulo).toBeUndefined();
    expect(porNome["Projeto Y"].secao_titulo).toBe("Detalhe");
  });

  it("obter_secao devolve o conteúdo sem \\r", async () => {
    const app = fakeVault([
      {
        path: "Log.md",
        content: "# Log\r\n## Sumario\r\n- [[Log A]] | [[Log B]]\r\n## Corpo\r\nlinha real com acesso\r\n",
      },
    ]);
    const engine = new VaultSearchEngine(app);

    const res = await engine.search({ acao: "obter_secao", nota: "Log", linha_inicio: 1, linha_fim: 3 });
    const conteudoLido = res.resultados[0].conteudo ?? "";
    expect(conteudoLido).toContain("## Sumario");
    expect(conteudoLido).not.toContain("\r");
  });

  it("escolhe a linha com mais termos distintos; em empate, a primeira", async () => {
    const app = fakeVault([
      { path: "Notas/T.md", content: "# Nota\nacesso solto\nacesso ao projeto novo\nprojeto sozinho\n" },
    ]);
    const engine = new VaultSearchEngine(app);

    const dois = await engine.search({ termos: ["acesso", "projeto"] });
    expect(dois.resultados[0].trecho).toBe("acesso ao projeto novo");
    expect(dois.resultados[0].linha).toBe(3);

    const empate = await engine.search({ termos: ["acesso"] });
    expect(empate.resultados[0].trecho).toBe("acesso solto");
    expect(empate.resultados[0].linha).toBe(2);

    const exato = await engine.search({ termos: ["acesso", "proj"], exato: true });
    expect(exato.resultados[0].trecho).toBe("acesso solto");
  });
});
