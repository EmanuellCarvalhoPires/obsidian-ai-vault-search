import { describe, expect, it } from "vitest";
import {
  extractSymbolBlock,
  findEnclosingSymbol,
  listSymbols,
} from "../src/search/symbols";

const TS =
  "export function soma(a: number, b: number) {\n  return a + b;\n}\nexport class Calc {\n  dobro(x: number) {\n    return x * 2;\n  }\n}\n";
const PY = "def a():\n    return 1\n\ndef b():\n    return 2\n";

describe("listSymbols", () => {
  it("lista funções, classes e métodos com a linha de cada um", () => {
    expect(listSymbols(TS, "ts")).toEqual([
      { nome: "soma", tipo: "funcao", linha: 1 },
      { nome: "Calc", tipo: "classe", linha: 4 },
      { nome: "dobro", tipo: "metodo", linha: 5 },
    ]);
  });

  it("extensão sem família devolve lista vazia", () => {
    expect(listSymbols(TS, "txt")).toEqual([]);
  });
});

describe("findEnclosingSymbol", () => {
  it("acha o símbolo que envolve a linha do return do método", () => {
    expect(findEnclosingSymbol(TS.split("\n"), 5, "ts")).toBe("dobro");
  });

  it("acha a função de topo para uma linha dentro dela", () => {
    expect(findEnclosingSymbol(TS.split("\n"), 1, "ts")).toBe("soma");
  });
});

describe("extractSymbolBlock", () => {
  it("extrai o bloco completo de uma função em chaves", () => {
    expect(extractSymbolBlock(TS, "ts", "soma")).toEqual({
      nome: "soma",
      linha_inicio: 1,
      linha_fim: 3,
      conteudo: "export function soma(a: number, b: number) {\n  return a + b;\n}",
    });
  });

  it("extrai o bloco de um método pelo nome", () => {
    expect(extractSymbolBlock(TS, "ts", "dobro")).toEqual({
      nome: "dobro",
      linha_inicio: 5,
      linha_fim: 7,
      conteudo: "  dobro(x: number) {\n    return x * 2;\n  }",
    });
  });

  it("procura o nome ignorando maiúsculas quando não há correspondência exata", () => {
    const bloco = extractSymbolBlock(TS, "ts", "CALC");
    expect(bloco?.nome).toBe("Calc");
    expect(bloco?.linha_inicio).toBe(4);
    expect(bloco?.linha_fim).toBe(8);
  });

  it("extrai o bloco de uma função em Python pela indentação", () => {
    const bloco = extractSymbolBlock(PY, "py", "a");
    expect(bloco?.linha_inicio).toBe(1);
    expect(bloco?.linha_fim).toBe(2);
    expect(bloco?.conteudo).toBe("def a():\n    return 1");
  });

  it("ignora chaves de tipo inline dentro da assinatura multilinha", () => {
    const src = "export function f(\n  a: number,\n  opts?: { x?: number },\n): number {\n  return a;\n}\n";
    const bloco = extractSymbolBlock(src, "ts", "f");
    expect(bloco?.linha_inicio).toBe(1);
    expect(bloco?.linha_fim).toBe(6);
    expect(bloco?.conteudo).toContain("return a;");
  });

  it("devolve undefined para nome inexistente", () => {
    expect(extractSymbolBlock(TS, "ts", "inexistente")).toBeUndefined();
  });

  it("devolve undefined para extensão sem família", () => {
    expect(extractSymbolBlock(TS, "txt", "soma")).toBeUndefined();
  });

  it("ignora chave dentro de string", () => {
    const src = 'function f() {\n  const s = "}";\n  return s;\n}\n';
    expect(extractSymbolBlock(src, "ts", "f")?.linha_fim).toBe(4);
  });

  it("conta a chave depois de string com //", () => {
    const src = 'function f() {\n  const x = "http://x"; if (x) {\n    g();\n  }\n  return x;\n}\n';
    expect(extractSymbolBlock(src, "ts", "f")?.linha_fim).toBe(6);
  });

  it("ignora chave em comentário de bloco", () => {
    const src = "function f() {\n  /* { */\n  return 1;\n}\nfunction g() {\n}\n";
    expect(extractSymbolBlock(src, "ts", "f")?.linha_fim).toBe(4);
  });

  it("trata lifetime do Rust como não-string", () => {
    const src = "fn f<'a>(x: &'a str) {\n  x\n}\n";
    expect(extractSymbolBlock(src, "rs", "f")?.linha_fim).toBe(3);
  });
});
