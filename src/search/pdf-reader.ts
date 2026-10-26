// PDF text extraction through an injected PDF.js loader (testable without Obsidian).

export type PdfLoader = () => Promise<PdfJsLike>;

export interface PdfJsLike {
  getDocument(opts: { data: Uint8Array }): { promise: Promise<PdfDocLike> };
}

export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  }>;
}

// Returns the text of each page; index 0 is page 1.
export async function extractPdfPages(dados: Uint8Array, loader: PdfLoader): Promise<string[]> {
  const pdfjs = await loader();
  const doc = await pdfjs.getDocument({ data: dados }).promise;
  const paginas: string[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let texto = "";
    for (const item of content.items) {
      texto += item.str ?? "";
      texto += item.hasEOL ? "\n" : " ";
    }
    paginas.push(texto.replace(/[ \t]+/g, " ").trim());
  }

  return paginas;
}
