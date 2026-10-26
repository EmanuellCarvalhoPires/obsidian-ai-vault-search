import { describe, expect, it } from "vitest";
import { ContentCache } from "../src/search/content-cache";

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
});
