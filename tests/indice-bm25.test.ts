import { describe, expect, it } from "vitest";
import { IndiceBm25, tokenizar } from "../src/search/indice-bm25";
import type { CamposDocumento, TermoConsulta } from "../src/search/indice-bm25";

const vazio: CamposDocumento = { titulo: "", tags: "", up: "", corpo: "" };

function doc(parcial: Partial<CamposDocumento>): CamposDocumento {
  return { ...vazio, ...parcial };
}

function termo(...variantes: string[]): TermoConsulta {
  return { variantes };
}

describe("tokenizar", () => {
  it("normaliza, remove acentos e separa em palavras alfanuméricas", () => {
    expect(tokenizar("Ação Rápida: Fluxo_2")).toEqual(["acao", "rapida", "fluxo", "2"]);
  });
});

describe("IndiceBm25", () => {
  it("(2) o documento com o termo no título pontua mais que o com o termo no corpo", () => {
    const indice = new IndiceBm25();
    indice.atualizar("A", doc({ titulo: "alvo", corpo: "um dois tres" }));
    indice.atualizar("B", doc({ titulo: "nome", corpo: "um alvo tres" }));
    indice.atualizar("C", doc({ titulo: "outro", corpo: "quatro cinco seis" }));

    const pontos = indice.pontuar([termo("alvo")], { exato: false });

    expect(pontos.has("C")).toBe(false);
    expect(pontos.get("A")!).toBeGreaterThan(pontos.get("B")!);
  });

  it("(3) termo raro pontua mais que termo comum no mesmo documento", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "raro comum x" }));
    indice.atualizar("D2", doc({ corpo: "comum y z" }));
    indice.atualizar("D3", doc({ corpo: "comum w v" }));

    const raro = indice.pontuar([termo("raro")], { exato: false }).get("D1")!;
    const comum = indice.pontuar([termo("comum")], { exato: false }).get("D1")!;

    expect(raro).toBeGreaterThan(comum);
  });

  it("(4) saturação: 100 ocorrências pontuam menos de 10 vezes mais que 3", () => {
    const indice = new IndiceBm25();
    indice.atualizar("A", doc({ corpo: "alvo alvo alvo" }));
    indice.atualizar("B", doc({ corpo: "alvo ".repeat(100).trim() }));
    indice.atualizar("C", doc({ corpo: "x y z" }));

    const pontos = indice.pontuar([termo("alvo")], { exato: false });

    expect(pontos.get("B")! / pontos.get("A")!).toBeLessThan(10);
  });

  it("(5) sem exato, a variante casa token que a contém; com exato só casa igualdade", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "validar regras" }));

    expect(indice.pontuar([termo("valid")], { exato: false }).has("D1")).toBe(true);
    expect(indice.pontuar([termo("valid")], { exato: true }).has("D1")).toBe(false);
    expect(indice.pontuar([termo("validar")], { exato: true }).has("D1")).toBe(true);
  });

  it("(6) remover tira o documento do resultado e tem() vira false", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "alvo" }));
    indice.atualizar("D2", doc({ corpo: "alvo outro" }));

    indice.remover("D1");

    expect(indice.tem("D1")).toBe(false);
    expect(indice.tamanho).toBe(1);
    expect(indice.pontuar([termo("alvo")], { exato: false }).has("D1")).toBe(false);
    expect(indice.pontuar([termo("alvo")], { exato: false }).has("D2")).toBe(true);
  });

  it("(7) atualizar um id existente troca o conteúdo sem crescer", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "antigo" }));

    indice.atualizar("D1", doc({ corpo: "novo" }));

    expect(indice.tamanho).toBe(1);
    expect(indice.pontuar([termo("antigo")], { exato: false }).has("D1")).toBe(false);
    expect(indice.pontuar([termo("novo")], { exato: false }).has("D1")).toBe(true);
  });

  it("(8) candidatos restringe os ids sem mudar a pontuação dos que ficam", () => {
    const indice = new IndiceBm25();
    indice.atualizar("A", doc({ titulo: "alvo", corpo: "um dois" }));
    indice.atualizar("B", doc({ corpo: "alvo tres quatro" }));
    indice.atualizar("C", doc({ corpo: "cinco seis sete" }));

    const semFiltro = indice.pontuar([termo("alvo")], { exato: false });
    const comFiltro = indice.pontuar([termo("alvo")], { exato: false, candidatos: new Set(["A"]) });

    expect([...comFiltro.keys()]).toEqual(["A"]);
    expect(comFiltro.get("A")).toBeCloseTo(semFiltro.get("A")!, 12);
  });

  it("(9) termos inexistentes ou índice vazio devolvem mapa vazio", () => {
    const indice = new IndiceBm25();
    expect(indice.pontuar([termo("alvo")], { exato: false }).size).toBe(0);

    indice.atualizar("D1", doc({ corpo: "outro texto" }));
    expect(indice.pontuar([termo("inexistente")], { exato: false }).size).toBe(0);
  });

  it("(10) documento com dois termos pontua mais que com um só", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "alfa beta x" }));
    indice.atualizar("D2", doc({ corpo: "alfa y z" }));

    const pontos = indice.pontuar([termo("alfa"), termo("beta")], { exato: false });

    expect(pontos.get("D1")!).toBeGreaterThan(pontos.get("D2")!);
  });

  it("ignora variantes vazias", () => {
    const indice = new IndiceBm25();
    indice.atualizar("D1", doc({ corpo: "alvo" }));

    expect(indice.pontuar([termo("")], { exato: false }).size).toBe(0);
  });
});
