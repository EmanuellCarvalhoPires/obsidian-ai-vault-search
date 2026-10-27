import { describe, expect, it } from "vitest";
import { normalizar, searchText } from "../src/search/text-search";

describe("normalizar", () => {
  it("remove acentos, põe em minúsculas e apara espaços", () => {
    expect(normalizar("  Olá MUNDO ")).toBe("ola mundo");
  });
});

describe("searchText", () => {
  it("devolve as linhas que contêm o termo, sem diferenciar maiúsculas", () => {
    const conteudo = "Olá Mundo\nsegunda linha\nMUNDO de novo";
    const r = searchText(conteudo, ["mundo"], { extensao: "txt", max: 10 });
    expect(r.map((t) => t.linha)).toEqual([1, 3]);
    expect(r[0].trecho).toBe("Olá Mundo");
    expect(r[0].simbolo_envolvente).toBeUndefined();
  });

  it("ignora acento no termo e no texto", () => {
    const r = searchText("Olá Mundo", ["ola"], { extensao: "txt", max: 10 });
    expect(r).toHaveLength(1);
    expect(r[0].linha).toBe(1);
  });

  it("respeita o máximo de trechos", () => {
    const r = searchText("a\na\na", ["a"], { extensao: "txt", max: 1 });
    expect(r).toHaveLength(1);
    expect(r[0].linha).toBe(1);
  });

  it("informa o símbolo envolvente só em arquivos de código", () => {
    const ts = "function soma(a: number, b: number) {\n  return retorno;\n}\n";
    const comCodigo = searchText(ts, ["retorno"], { extensao: "ts", max: 10 });
    expect(comCodigo).toHaveLength(1);
    expect(comCodigo[0].simbolo_envolvente).toBe("soma");

    const comTexto = searchText(ts, ["retorno"], { extensao: "txt", max: 10 });
    expect(comTexto).toHaveLength(1);
    expect(comTexto[0].simbolo_envolvente).toBeUndefined();
  });

  it("devolve lista vazia para termos vazios ou ausentes", () => {
    expect(searchText("qualquer coisa", [""], { extensao: "txt", max: 10 })).toEqual([]);
    expect(searchText("qualquer coisa", [], { extensao: "txt", max: 10 })).toEqual([]);
  });

  it("corta o trecho em 200 caracteres", () => {
    const longa = "x".repeat(300);
    const r = searchText(longa, ["x"], { extensao: "txt", max: 1 });
    expect(r[0].trecho).toHaveLength(200);
  });

  it("aceita o texto como string ou como lista de linhas, com resultado igual", () => {
    const texto = "primeira\nalvo aqui\nterceira\nalvo de novo";
    const comString = searchText(texto, ["alvo"], { extensao: "txt", max: 5 });
    const comLinhas = searchText(texto.split("\n"), ["alvo"], { extensao: "txt", max: 5 });
    expect(comString).toHaveLength(2);
    expect(comLinhas).toEqual(comString);
  });

  it("aceita lista de linhas em codigo e mantem o simbolo envolvente", () => {
    const ts = "function soma(a: number, b: number) {\n  return retorno;\n}\n";
    const comString = searchText(ts, ["retorno"], { extensao: "ts", max: 5 });
    const comLinhas = searchText(ts.split("\n"), ["retorno"], { extensao: "ts", max: 5 });
    expect(comString[0].simbolo_envolvente).toBe("soma");
    expect(comLinhas).toEqual(comString);
  });
});
