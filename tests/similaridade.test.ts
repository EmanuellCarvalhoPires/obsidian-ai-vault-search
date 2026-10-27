import { describe, expect, it } from "vitest";
import { distancia, maisParecidos } from "../src/search/similaridade";

describe("distancia", () => {
  it("calcula a distancia de edicao entre textos normalizados", () => {
    expect(distancia("gato", "gata")).toBe(1);
    expect(distancia("Ação", "acao")).toBe(0);
  });
});

describe("maisParecidos", () => {
  it("ignora barras no alvo e acha a pasta exata", () => {
    expect(maisParecidos("mcp/", ["MCP", "Projetos", "Arquivo"])).toEqual(["MCP"]);
  });

  it("acha o nome que contem o alvo", () => {
    expect(maisParecidos("notificacoes", ["Referência - Notificações no Telegram", "Outra"])[0]).toBe(
      "Referência - Notificações no Telegram",
    );
  });

  it("acha o nome com erro de digitacao", () => {
    expect(maisParecidos("autmacao", ["automacao", "projeto"])).toEqual(["automacao"]);
  });

  it("sem parecidos devolve lista vazia", () => {
    expect(maisParecidos("xyz", ["abcdef"])).toEqual([]);
  });

  it("respeita o limite max", () => {
    expect(maisParecidos("nota", ["nota1", "nota2", "nota3"], 2)).toHaveLength(2);
  });

  it("alvo vazio devolve lista vazia", () => {
    expect(maisParecidos("", ["nota"])).toEqual([]);
    expect(maisParecidos("/", ["nota"])).toEqual([]);
  });
});
