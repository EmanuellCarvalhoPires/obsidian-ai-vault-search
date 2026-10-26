import { describe, expect, it } from "vitest";
import {
  cellRef,
  columnIndex,
  columnLetter,
  parseDelimited,
} from "../src/search/tabular-parser";

describe("columnLetter / columnIndex / cellRef", () => {
  it("converte índices de coluna em letras", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(701)).toBe("ZZ");
  });

  it("converte letras em índice, aceitando minúsculas e rejeitando inválidos", () => {
    expect(columnIndex("AA")).toBe(26);
    expect(columnIndex("aa")).toBe(26);
    expect(columnIndex("1")).toBe(-1);
    expect(columnIndex("")).toBe(-1);
  });

  it("monta a referência da célula", () => {
    expect(cellRef(1, 14)).toBe("B14");
  });
});

describe("parseDelimited", () => {
  it("detecta ponto e vírgula e lê as linhas", () => {
    expect(parseDelimited("id;nome\n1;Ana\n2;Beto\n")).toEqual({
      delimitador: ";",
      linhas: [
        ["id", "nome"],
        ["1", "Ana"],
        ["2", "Beto"],
      ],
    });
  });

  it("trata campos entre aspas com delimitador e aspas duplicadas", () => {
    const { linhas } = parseDelimited('a,b\n"x,y","dis ""ok"""\n');
    expect(linhas[1]).toEqual(["x,y", 'dis "ok"']);
  });

  it("detecta tabulação em texto TSV", () => {
    expect(parseDelimited("a\tb\n1\t2\n").delimitador).toBe("\t");
  });

  it("remove o BOM do início", () => {
    expect(parseDelimited("﻿a,b\n").linhas[0]?.[0]).toBe("a");
  });

  it("usa vírgula quando não há delimitador ou há empate", () => {
    expect(parseDelimited("texto simples\n").delimitador).toBe(",");
    expect(parseDelimited("a;b,c\n").delimitador).toBe(",");
  });

  it("aceita \\r\\n, ignora a linha vazia final e não preenche colunas faltantes", () => {
    expect(parseDelimited("a,b,c\r\n1,2\r\n")).toEqual({
      delimitador: ",",
      linhas: [
        ["a", "b", "c"],
        ["1", "2"],
      ],
    });
  });

  it("aceita quebra de linha dentro de campo entre aspas", () => {
    expect(parseDelimited('a,b\n"linha1\nlinha2",x\n').linhas[1]).toEqual([
      "linha1\nlinha2",
      "x",
    ]);
  });

  it("ignora linhas vazias no fim do texto (com \\n ou \\r\\n, uma ou mais)", () => {
    const esperado = [["a", "b"]];
    expect(parseDelimited("a,b\n\n").linhas).toEqual(esperado);
    expect(parseDelimited("a,b\n1,2\n\n").linhas).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimited("a,b\r\n1,2\r\n\r\n").linhas).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimited("a,b\n1,2\n\n\n").linhas).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("mantém linhas vazias no meio do texto", () => {
    expect(parseDelimited("a\n\nb\n").linhas).toEqual([["a"], [""], ["b"]]);
  });
});
