import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";
import { getSectionUniversal } from "../src/search/universal-read";
import type { UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

// Fake PDF loader: this file never reads a PDF.
const pdfLoader: PdfLoader = async () => {
  throw new Error("pdf nao esperado");
};

function contexto(): UniversalContext {
  const conteudo: ConteudoDeps = { cache: new ContentCache<Conteudo>(), pdfLoader };
  return { basePath: pasta, excluidas: [], conteudo };
}

const CRASE = String.fromCharCode(96);
const CERCA = CRASE.repeat(3);

// Line 1 to 4 is the frontmatter; "## Uso" is line 15.
const LINHAS = [
  "---",
  "titulo: x",
  "# comentario yaml",
  "---",
  "# Titulo",
  "## Instalar",
  CERCA,
  "# comentario de shell",
  "npm i",
  CERCA,
  "depois da cerca",
  "~~~~",
  "# outro comentario",
  "~~~~",
  "## Uso",
  "texto de uso",
];

beforeAll(() => {
  fs.writeFileSync(path.join(pasta, "doc.md"), LINHAS.join("\n"));
});

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe("cabecalhos de markdown ignoram cercas de codigo e frontmatter", () => {
  it("listar sem secao mostra so os cabecalhos reais", async () => {
    const r = await getSectionUniversal({ arquivo: "doc.md" }, contexto());
    expect(r.total).toBe(1);
    const titulos = r.resultados[0].cabecalhos_disponiveis?.map((c) => c.titulo);
    expect(titulos).toEqual(["Titulo", "Instalar", "Uso"]);
  });

  it("a secao anterior ao bloco inclui o bloco de codigo inteiro", async () => {
    const r = await getSectionUniversal({ arquivo: "doc.md", secao: "Instalar" }, contexto());
    expect(r.total).toBe(1);
    const conteudo = r.resultados[0].conteudo ?? "";
    expect(conteudo).toContain("# comentario de shell");
    expect(conteudo).toContain("npm i");
    expect(conteudo).toContain("depois da cerca");
    expect(conteudo).not.toContain("texto de uso");
  });

  it("a linha de Uso e o numero real da linha no arquivo, contando o frontmatter", async () => {
    const r = await getSectionUniversal({ arquivo: "doc.md", secao: "Uso" }, contexto());
    expect(r.total).toBe(1);
    expect(r.resultados[0].secao_linha).toBe(LINHAS.indexOf("## Uso") + 1);
    expect(r.resultados[0].secao_linha).toBe(15);
  });
});
