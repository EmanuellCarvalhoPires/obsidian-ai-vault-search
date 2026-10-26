import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";
import { getSectionUniversal } from "../src/search/universal-read";
import type { UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

function escrever(rel: string, conteudo: string | Uint8Array): void {
  const abs = path.join(pasta, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

// Document: a Heading1 "Intro" followed by two paragraphs.
async function criarDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Primeiro paragrafo.</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Segundo paragrafo.</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

// Fake PDF.js with 3 pages.
const pdfLoader: PdfLoader = async () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: [{ str: ["pagina um", "pagina dois", "pagina tres"][n - 1] }],
        }),
      }),
    }),
  }),
});

function contexto(basePath: string = pasta, excluidas: string[] = []): UniversalContext {
  const conteudo: ConteudoDeps = { cache: new ContentCache<Conteudo>(), pdfLoader };
  return { basePath, excluidas, conteudo };
}

function ler(arquivo: string, extra: Partial<Parameters<typeof getSectionUniversal>[0]> = {}, ctx = contexto()) {
  return getSectionUniversal({ arquivo, ...extra }, ctx);
}

beforeAll(async () => {
  escrever(
    "src/a.ts",
    "export function soma(a: number, b: number): number {\n" +
      "  return a + b;\n" +
      "}\n" +
      "\n" +
      "export function subtrai(a: number, b: number): number {\n" +
      "  return a - b;\n" +
      "}\n" +
      "\n" +
      "export function multiplica(a: number, b: number): number {\n" +
      "  return a * b;\n" +
      "}\n",
  );
  escrever(
    "doc.md",
    "# Titulo geral\nIntroducao.\n\n## Um\nTexto um.\n\n## Dois\nTexto dois.\nSegunda linha de dois.\n\n### Subsecao de dois\nDetalhe.\n\n## Tres\nFim.\n",
  );
  escrever("notas.txt", "linha 1\nlinha 2\nlinha 3\nlinha 4\nlinha 5\n");
  escrever("intro.docx", await criarDocx());
  escrever("r.pdf", new Uint8Array([37, 80, 68, 70]));
  escrever("planilha.xlsx", new Uint8Array([80, 75, 3, 4]));
  escrever("anexos/segredo.txt", "conteudo fora do alcance\n");
  escrever("grande.txt", Array.from({ length: 250 }, (_, i) => `linha ${i + 1}`).join("\n") + "\n");
});

describe("getSectionUniversal", () => {
  it("devolve o bloco completo da funcao pelo nome do simbolo", async () => {
    const r = await ler("src/a.ts", { secao: "soma" });
    expect(r.total).toBe(1);
    expect(r.resultados[0]).toMatchObject({
      tipo: "codigo",
      caminho: "src/a.ts",
      nome: "a.ts",
      extensao: "ts",
      secao_titulo: "soma",
      secao_linha: 1,
      linha_inicio: 1,
      linha_fim: 3,
      conteudo: "export function soma(a: number, b: number): number {\n  return a + b;\n}",
    });
  });

  it("sem secao, lista os simbolos do arquivo de codigo", async () => {
    const r = await ler("src/a.ts");
    expect(r.total).toBe(1);
    const nomes = r.resultados[0].simbolos_disponiveis?.map((s) => s.nome);
    expect(nomes).toEqual(["soma", "subtrai", "multiplica"]);
    expect(r.dicas).toEqual(["Use 'secao' ou linha_inicio/linha_fim para ler o trecho"]);
  });

  it("simbolo inexistente devolve total 0 e cita os simbolos disponiveis", async () => {
    const r = await ler("src/a.ts", { secao: "inexistente" });
    expect(r.total).toBe(0);
    expect(r.resultados).toHaveLength(0);
    expect(r.dicas?.[0]).toContain("Disponíveis: soma, subtrai, multiplica");
  });

  it("linha_inicio e linha_fim devolvem exatamente as linhas pedidas", async () => {
    const r = await ler("notas.txt", { linha_inicio: 2, linha_fim: 3 });
    expect(r.total).toBe(1);
    expect(r.resultados[0]).toMatchObject({ tipo: "texto", linha: 2, conteudo: "linha 2\nlinha 3" });
  });

  it("markdown com secao comeca no cabecalho e vai ate o proximo de mesmo nivel", async () => {
    const r = await ler("doc.md", { secao: "dois" });
    expect(r.total).toBe(1);
    const conteudo = r.resultados[0].conteudo ?? "";
    expect(conteudo.startsWith("## Dois")).toBe(true);
    expect(conteudo).toContain("### Subsecao de dois");
    expect(conteudo).not.toContain("## Tres");
  });

  it("markdown sem secao lista os cabecalhos", async () => {
    const r = await ler("doc.md");
    expect(r.total).toBe(1);
    expect(r.resultados[0].cabecalhos_disponiveis?.map((c) => c.titulo)).toEqual([
      "Titulo geral",
      "Um",
      "Dois",
      "Subsecao de dois",
      "Tres",
    ]);
  });

  it("markdown com secao inexistente lista os cabecalhos na dica", async () => {
    const r = await ler("doc.md", { secao: "nada" });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Cabeçalhos: Titulo geral, Um, Dois");
  });

  it("docx com secao devolve os paragrafos seguintes ao cabecalho", async () => {
    const r = await ler("intro.docx", { secao: "intro" });
    expect(r.total).toBe(1);
    expect(r.resultados[0]).toMatchObject({
      tipo: "documento",
      secao_titulo: "Intro",
      conteudo: "Primeiro paragrafo.\nSegundo paragrafo.",
    });
  });

  it("pdf com intervalo de paginas junta as paginas com o separador", async () => {
    const r = await ler("r.pdf", { pagina_inicio: 2, pagina_fim: 3 });
    expect(r.total).toBe(1);
    expect(r.resultados[0].pagina).toBe(2);
    expect(r.resultados[0].conteudo).toBe("pagina dois\n\n--- página 3 ---\n\npagina tres");
  });

  it("pdf sem paginas le a pagina 1 e informa o total de paginas", async () => {
    const r = await ler("r.pdf");
    expect(r.resultados[0]).toMatchObject({ pagina: 1, conteudo: "pagina um" });
    expect(r.dicas).toEqual(["PDF com 3 páginas; use pagina_inicio/pagina_fim"]);
  });

  it("caminho inexistente devolve total 0 e dica de arquivo nao encontrado", async () => {
    const r = await ler("nao-existe.ts");
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual(["Arquivo não encontrado: nao-existe.ts"]);
  });

  it("alvo que e pasta devolve total 0 e a dica de pasta; inexistente continua nao encontrado", async () => {
    const r = await ler("src");
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual([
      "O caminho aponta para uma pasta; informe um arquivo (use list_files para listar o conteúdo da pasta).",
    ]);
    const n = await ler("src/nao-existe");
    expect(n.dicas).toEqual(["Arquivo não encontrado: src/nao-existe"]);
  });

  it("pasta excluida nao revela que e pasta", async () => {
    const r = await ler("anexos", {}, contexto(pasta, ["anexos"]));
    expect(r.dicas).toEqual(["Arquivo não encontrado: anexos"]);
  });

  it("docx com intervalo maior que o ultimo paragrafo devolve a dica com o numero", async () => {
    const r = await ler("intro.docx", { linha_inicio: 1, linha_fim: 99 });
    expect(r.total).toBe(1);
    const ultimo = r.resultados[0].linha_fim;
    expect(r.dicas).toEqual([`Intervalo limitado ao último parágrafo com texto (${ultimo}).`]);
  });

  it("docx com intervalo dentro do teto nao tem a dica", async () => {
    const r = await ler("intro.docx", { linha_inicio: 1, linha_fim: 2 });
    expect(r.total).toBe(1);
    expect(r.dicas).toBeUndefined();
  });

  it("xlsx devolve total 0 e manda usar read_table", async () => {
    const r = await ler("planilha.xlsx");
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual(["Para planilhas use a tool read_table"]);
  });

  it("arquivo dentro de pasta excluida e tratado como nao encontrado", async () => {
    const r = await ler("anexos/segredo.txt", {}, contexto(pasta, ["anexos"]));
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual(["Arquivo não encontrado: anexos/segredo.txt"]);
  });

  it("caminho relativo sem basePath devolve total 0 com a dica do cofre", async () => {
    const r = await ler("src/a.ts", {}, contexto(""));
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual(["Caminho do cofre indisponível"]);
  });

  it("caminho absoluto funciona sem basePath", async () => {
    const absoluto = path.join(pasta, "notas.txt");
    const r = await ler(absoluto, { linha_inicio: 1, linha_fim: 1 }, contexto(""));
    expect(r.total).toBe(1);
    expect(r.resultados[0].conteudo).toBe("linha 1");
  });

  it("texto sem intervalo devolve as primeiras 200 linhas com dica de paginacao", async () => {
    const r = await ler("grande.txt");
    expect(r.total).toBe(1);
    expect(r.resultados[0].linha_fim).toBe(200);
    expect(r.resultados[0].conteudo?.split("\n")).toHaveLength(200);
    expect(r.dicas).toEqual(["Arquivo com 250 linhas; use linha_inicio/linha_fim"]);
  });
});
