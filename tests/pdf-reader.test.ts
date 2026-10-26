import { describe, expect, it } from "vitest";
import { extractPdfPages, type PdfJsLike } from "../src/search/pdf-reader";

type Item = { str?: string; hasEOL?: boolean };

// Fake PDF.js: each page is a list of text items.
function loaderFalso(paginas: Item[][]): () => Promise<PdfJsLike> {
  return async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: paginas.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({ items: paginas[n - 1] }),
        }),
      }),
    }),
  });
}

const dados = new Uint8Array([1, 2, 3]);

describe("extractPdfPages", () => {
  it("junta os itens de cada página com espaço, uma string por página", async () => {
    const loader = loaderFalso([
      [{ str: "Olá" }, { str: "mundo" }],
      [{ str: "fim" }],
    ]);
    expect(await extractPdfPages(dados, loader)).toEqual(["Olá mundo", "fim"]);
  });

  it("acrescenta quebra de linha após item com hasEOL", async () => {
    const loader = loaderFalso([
      [{ str: "linha um", hasEOL: true }, { str: "linha dois" }],
    ]);
    expect(await extractPdfPages(dados, loader)).toEqual(["linha um\nlinha dois"]);
  });

  it("propaga o erro do loader", async () => {
    const loader = async (): Promise<PdfJsLike> => {
      throw new Error("x");
    };
    await expect(extractPdfPages(dados, loader)).rejects.toThrow("x");
  });
});
