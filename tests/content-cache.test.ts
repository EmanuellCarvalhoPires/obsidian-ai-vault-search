import { describe, expect, it } from "vitest";
import { ContentCache } from "../src/search/content-cache";
import { estimarBytes } from "../src/search/file-content";

describe("ContentCache", () => {
  it("devolve o valor quando mtime e tamanho batem", () => {
    const cache = new ContentCache<string>();
    cache.set("a", 1, 10, "x");
    expect(cache.get("a", 1, 10)).toBe("x");
  });

  it("descarta a entrada quando o mtime mudou", () => {
    const cache = new ContentCache<string>();
    cache.set("a", 1, 10, "x");
    expect(cache.get("a", 2, 10)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("descarta a entrada quando o tamanho mudou", () => {
    const cache = new ContentCache<string>();
    cache.set("a", 1, 10, "x");
    expect(cache.get("a", 1, 11)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("remove a entrada menos recente ao passar de maxEntradas", () => {
    const cache = new ContentCache<string>(2);
    cache.set("a", 1, 10, "x");
    cache.set("b", 1, 10, "y");
    expect(cache.get("a", 1, 10)).toBe("x");
    cache.set("c", 1, 10, "z");
    expect(cache.size).toBe(2);
    expect(cache.get("b", 1, 10)).toBeUndefined();
    expect(cache.get("a", 1, 10)).toBe("x");
    expect(cache.get("c", 1, 10)).toBe("z");
  });

  it("clear esvazia o cache", () => {
    const cache = new ContentCache<string>();
    cache.set("a", 1, 10, "x");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("remove as entradas mais antigas ao passar do limite de bytes", () => {
    const cache = new ContentCache<string>(200, 100);
    cache.set("a", 1, 10, "x", 40);
    cache.set("b", 1, 10, "y", 40);
    cache.set("c", 1, 10, "z", 40);
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(80);
    expect(cache.get("a", 1, 10)).toBeUndefined();
    expect(cache.get("b", 1, 10)).toBe("y");
    expect(cache.get("c", 1, 10)).toBe("z");
  });

  it("nao guarda uma entrada maior que o limite de bytes", () => {
    const cache = new ContentCache<string>(200, 100);
    cache.set("grande", 1, 10, "x", 150);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.get("grande", 1, 10)).toBeUndefined();
  });

  it("regravar a mesma chave ajusta o total de bytes", () => {
    const cache = new ContentCache<string>(200, 100);
    cache.set("a", 1, 10, "x", 40);
    cache.set("a", 2, 10, "y", 70);
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(70);
    expect(cache.get("a", 2, 10)).toBe("y");
  });

  it("descontar os bytes quando get descarta por mtime", () => {
    const cache = new ContentCache<string>(200, 100);
    cache.set("a", 1, 10, "x", 40);
    expect(cache.get("a", 2, 10)).toBeUndefined();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("estimarBytes segue a formula 64 + 2 * caracteres de um texto de 2 linhas", () => {
    expect(estimarBytes({ tipo: "texto", linhas: ["ab", "c"] })).toBe(64 + 2 * 5);
  });
});
