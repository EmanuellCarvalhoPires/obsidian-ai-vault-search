import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  filtrarBaixaPontuacao,
  findUniversal,
  pontuarNome,
  pontuarNomeDetalhado,
} from "../src/search/universal-find";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

function escrever(rel: string, conteudo: string): void {
  const abs = path.join(pasta, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

function buscar(query: string, extensoes: string[], limite = 50) {
  return findUniversal(
    { query, extensoes, pasta, limite },
    { basePath: pasta, excluidas: [] },
  );
}

beforeAll(() => {
  escrever("src/main.ts", "export const a = 1;\n");
  escrever("src/main.js", "exports.a = 1;\n");
  escrever("lib/domain.py", "a = 1\n");
  escrever("docs/Manual Main.pdf", "%PDF");
  escrever("node_modules/main.ts", "export const b = 2;\n");
});

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe("findUniversal", () => {
  it("acha main.ts e main.js pelo nome e ignora node_modules, .py e .pdf", async () => {
    const r = await buscar("main", ["ts", "js"]);
    const caminhos = r.resultados.map((x) => x.caminho);
    expect(r.total).toBe(2);
    expect(caminhos.some((c) => c.endsWith("src/main.ts"))).toBe(true);
    expect(caminhos.some((c) => c.endsWith("src/main.js"))).toBe(true);
    expect(caminhos.some((c) => c.endsWith(".py") || c.endsWith(".pdf"))).toBe(false);
    expect(caminhos.some((c) => c.includes("node_modules"))).toBe(false);
  });

  it("sem filtro de extensao, inclui Manual Main.pdf", async () => {
    const r = await buscar("main", []);
    expect(r.resultados.map((x) => x.nome)).toContain("Manual Main.pdf");
  });

  it("pontua o nome exato com 100 + 50 - 4 = 146", () => {
    expect(pontuarNome("main", "src/main.ts", "main")).toBe(146);
  });

  it("com limite 1 devolve um resultado, mas o total conta todos os casados", async () => {
    const r = await buscar("main", [], 1);
    expect(r.resultados).toHaveLength(1);
    expect(r.total).toBe(4);
  });

  it("query sem nenhum casamento devolve total 0", async () => {
    const r = await buscar("zzz-inexistente", []);
    expect(r.total).toBe(0);
    expect(r.resultados).toHaveLength(0);
  });
});

describe("findUniversal com pastas excluidas e caminho absoluto", () => {
  const outro = fs.mkdtempSync(path.join(os.tmpdir(), "avs-fora-"));

  beforeAll(() => {
    escrever("Arquivo/excl-velho.ts", "export const v = 1;\n");
    escrever("Vivo/excl-novo.ts", "export const n = 1;\n");
    fs.mkdirSync(path.join(outro, "Arquivo"), { recursive: true });
    fs.writeFileSync(path.join(outro, "Arquivo", "excl-fora.ts"), "export const f = 1;\n");
  });

  afterAll(() => {
    fs.rmSync(outro, { recursive: true, force: true });
  });

  const comExclusao = (alvo: string) =>
    findUniversal(
      { query: "excl", extensoes: ["ts"], pasta: alvo, limite: 50 },
      { basePath: pasta, excluidas: ["Arquivo"] },
    );

  it("caminho absoluto do cofre nao devolve arquivo de pasta excluida", async () => {
    const r = await comExclusao(pasta);
    const caminhos = r.resultados.map((x) => x.caminho);
    expect(caminhos.some((c) => c.endsWith("Vivo/excl-novo.ts"))).toBe(true);
    expect(caminhos.some((c) => c.includes("Arquivo/"))).toBe(false);
  });

  it("caminho absoluto de uma pasta excluida devolve total 0", async () => {
    const r = await comExclusao(path.join(pasta, "Arquivo"));
    expect(r.total).toBe(0);
  });

  it("caminho absoluto fora do cofre nao sofre as exclusoes", async () => {
    const r = await comExclusao(outro);
    expect(r.resultados.some((x) => x.caminho.endsWith("Arquivo/excl-fora.ts"))).toBe(true);
  });
});

describe("findUniversal descarta baixa pontuacao quando ha casamento completo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-baixa-"));

  beforeAll(() => {
    for (const nome of [
      "Comparativo de Eficiencia.txt",
      "Eficiencia Comparativo.txt",
      "Comparativo Eficiencia x.txt",
      "relatorio de vendas.txt",
      "Comparativo vendas.txt",
    ]) {
      fs.writeFileSync(path.join(dir, nome), "x");
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const buscarAqui = (query: string) =>
    findUniversal(
      { query, extensoes: ["txt"], pasta: dir, limite: 50 },
      { basePath: dir, excluidas: [] },
    );

  it("com casamento completo, mantem quem casou pelo menos metade dos termos e corta o resto", async () => {
    const r = await buscarAqui("Comparativo de Eficiencia");
    expect(r.resultados.map((x) => x.nome).sort()).toEqual([
      "Comparativo Eficiencia x.txt",
      "Comparativo de Eficiencia.txt",
      "Eficiencia Comparativo.txt",
    ]);
    expect(r.total).toBe(3);
  });

  it("sem nenhum casamento completo, os parciais continuam aparecendo", async () => {
    const r = await buscarAqui("zzz vendas");
    expect(r.resultados.map((x) => x.nome).sort()).toEqual([
      "Comparativo vendas.txt",
      "relatorio de vendas.txt",
    ]);
    expect(r.total).toBe(2);
  });

  it("sem consulta nao filtra nada", async () => {
    const r = await buscarAqui("");
    expect(r.total).toBe(5);
  });

  it("pontuarNomeDetalhado devolve casados e tokens do casamento completo", () => {
    const d = pontuarNomeDetalhado("Comparativo de Eficiencia", "Comparativo de Eficiencia.txt", "Comparativo de Eficiencia");
    expect(d.casados).toBe(3);
    expect(d.tokens).toBe(3);
    expect(d.pontos).toBe(pontuarNome("Comparativo de Eficiencia", "Comparativo de Eficiencia.txt", "Comparativo de Eficiencia"));
  });

  it("filtrarBaixaPontuacao remove quem casou 1 de 3 quando ha um completo", () => {
    const entrada = [
      { id: "completo", casados: 3, tokens: 3 },
      { id: "parcial", casados: 1, tokens: 3 },
    ];
    expect(filtrarBaixaPontuacao(entrada).map((x) => x.id)).toEqual(["completo"]);
  });

  it("filtrarBaixaPontuacao nao filtra quando nao ha casamento completo", () => {
    const entrada = [
      { id: "a", casados: 1, tokens: 3 },
      { id: "b", casados: 2, tokens: 3 },
    ];
    expect(filtrarBaixaPontuacao(entrada)).toHaveLength(2);
  });
});
