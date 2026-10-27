import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { escolherCabecalho } from "../src/search/cabecalho";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";
import { VaultSearchEngine } from "../src/search/search-engine";
import { getSectionUniversal } from "../src/search/universal-read";
import type { UniversalContext } from "../src/search/universal-search";
import { fakeVault } from "./helpers/fake-vault";

const titulo = (s: string) => s;

describe("escolherCabecalho", () => {
  it("prefere o cabecalho exato a um que apenas comeca igual", () => {
    expect(escolherCabecalho(["Catálogo de Logs", "Log"], titulo, "Log")).toBe("Log");
  });

  it("prefere o prefixo de palavra inteira a outro com o mesmo comeco", () => {
    expect(escolherCabecalho(["Fluxos Automatizados", "Fluxo de Desenvolvimento"], titulo, "Fluxo")).toBe(
      "Fluxo de Desenvolvimento",
    );
  });

  it("o exato vence o prefixo de palavra inteira", () => {
    expect(
      escolherCabecalho(["Fluxos Automatizados", "Fluxo", "Fluxo de Desenvolvimento"], titulo, "fluxo"),
    ).toBe("Fluxo");
  });

  it("prefere o prefixo de palavra inteira a um que contem o alvo no meio", () => {
    expect(escolherCabecalho(["Catálogo de Logs", "Logs de hoje"], titulo, "Logs")).toBe("Logs de hoje");
  });

  it("devolve undefined quando nenhum cabecalho casa", () => {
    expect(escolherCabecalho(["Outra"], titulo, "Passos")).toBeUndefined();
  });

  it("ignora acentos ao comparar", () => {
    const itens = ["Notificações no Telegram"];
    expect(escolherCabecalho(itens, titulo, "notificacoes")).toBe(itens[0]);
  });

  it("alvo vazio devolve undefined", () => {
    expect(escolherCabecalho(["Qualquer"], titulo, "")).toBeUndefined();
    expect(escolherCabecalho(["Qualquer"], titulo, "   ")).toBeUndefined();
  });

  it("em empate de pontuacao devolve o primeiro na ordem do documento", () => {
    expect(escolherCabecalho(["Plano A", "Plano B"], titulo, "Plano")).toBe("Plano A");
  });
});

describe("escolherCabecalho aplicado", () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

  // Fake PDF.js: never used by these tests (no PDF is read).
  const pdfLoader: PdfLoader = async () => {
    throw new Error("pdf nao esperado");
  };

  function contexto(): UniversalContext {
    const conteudo: ConteudoDeps = { cache: new ContentCache<Conteudo>(), pdfLoader };
    return { basePath: pasta, excluidas: [], conteudo };
  }

  function escrever(rel: string, conteudo: string): void {
    fs.writeFileSync(path.join(pasta, rel), conteudo);
  }

  const GUIA = "# Guia\n## Fluxos Automatizados\ntexto um\n## Fluxo de Desenvolvimento\ntexto dois\n";

  beforeAll(() => {
    escrever("guia.md", GUIA);
    escrever("log.md", "# Doc\n## Catálogo de Logs\ntexto catalogo\n## Log\ntexto log\n");
  });

  afterAll(() => {
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  it("motor: obter_secao com 'Fluxo' devolve 'Fluxo de Desenvolvimento'", async () => {
    const app = fakeVault([{ path: "Guia.md", content: GUIA }]);
    const engine = new VaultSearchEngine(app);
    const r = await engine.search({ acao: "obter_secao", nota: "Guia", cabecalho: "Fluxo" });
    expect(r.resultados[0].secao_titulo).toBe("Fluxo de Desenvolvimento");
    expect(r.resultados[0].conteudo).toContain("texto dois");
  });

  it("leitor universal: secao 'Fluxo' devolve 'Fluxo de Desenvolvimento'", async () => {
    const r = await getSectionUniversal({ arquivo: "guia.md", secao: "Fluxo" }, contexto());
    expect(r.total).toBe(1);
    expect(r.resultados[0].secao_titulo).toBe("Fluxo de Desenvolvimento");
  });

  it("leitor universal: secao 'Log' devolve a seção 'Log', não 'Catálogo de Logs'", async () => {
    const r = await getSectionUniversal({ arquivo: "log.md", secao: "Log" }, contexto());
    expect(r.total).toBe(1);
    expect(r.resultados[0].secao_titulo).toBe("Log");
    expect(r.resultados[0].conteudo).toContain("texto log");
  });

  it("motor: cabecalho inexistente mantém a dica de nao encontrado", async () => {
    const app = fakeVault([{ path: "Guia.md", content: GUIA }]);
    const engine = new VaultSearchEngine(app);
    const r = await engine.search({ acao: "obter_secao", nota: "Guia", cabecalho: "nada" });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Cabeçalho 'nada' não encontrado. Disponíveis: Guia, Fluxos Automatizados, Fluxo de Desenvolvimento");
  });

  it("leitor universal: cabecalho inexistente mantém a dica de nao encontrado", async () => {
    const r = await getSectionUniversal({ arquivo: "guia.md", secao: "nada" }, contexto());
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Seção 'nada' não encontrada. Cabeçalhos: Guia, Fluxos Automatizados, Fluxo de Desenvolvimento");
  });
});
