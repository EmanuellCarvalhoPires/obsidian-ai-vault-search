import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import {
  carregarConteudo,
  LIMITE_BINARIO_BYTES,
  LIMITE_TEXTO_BYTES,
  type ArquivoRef,
  type Conteudo,
  type ConteudoDeps,
} from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

function arquivo(nome: string, conteudo: string | Uint8Array): ArquivoRef {
  const abs = path.join(pasta, nome);
  fs.writeFileSync(abs, conteudo);
  const stat = fs.statSync(abs);
  return {
    abs,
    extensao: path.extname(nome).replace(/^\./, ""),
    tamanho: stat.size,
    mtime: stat.mtimeMs,
  };
}

function criarDeps(paginas: string[] = ["pagina 1", "pagina 2"]): {
  deps: ConteudoDeps;
  chamadas: () => number;
} {
  let chamadas = 0;
  const pdfLoader: PdfLoader = async () => {
    chamadas++;
    return {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: paginas.length,
          getPage: async (n: number) => ({
            getTextContent: async () => ({ items: [{ str: paginas[n - 1] }] }),
          }),
        }),
      }),
    };
  };
  return {
    deps: { cache: new ContentCache<Conteudo>(), pdfLoader },
    chamadas: () => chamadas,
  };
}

async function criarXlsx(): Promise<Uint8Array> {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook ${NS} xmlns:r="${NS_R}"><sheets>` +
      `<sheet name="Clientes" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Notas" sheetId="2" r:id="rId2"/>` +
      `</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Alfa</t></is></c><c r="B1"><v>7</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Outra aba</t></is></c></row>` +
      `</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function criarDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Titulo</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Corpo do texto</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("carregarConteudo", () => {
  it("lê um .ts com 3 linhas como código", async () => {
    const { deps } = criarDeps();
    const r = arquivo("trecho.ts", "const a = 1;\nconst b = 2;\nconst c = 3;");
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.tipo).toBe("codigo");
    expect(conteudo?.linhas).toHaveLength(3);
  });

  it("interpreta um .csv em abas com delimitador ;", async () => {
    const { deps } = criarDeps();
    const r = arquivo("tabela.csv", "a;b\n1;2");
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.tipo).toBe("tabela");
    expect(conteudo?.abas?.[0].linhas).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(conteudo?.linhas).toEqual(["a;b", "1;2"]);
  });

  it("remove o BOM inicial de um .csv, nas linhas e nas abas", async () => {
    const { deps } = criarDeps();
    const r = arquivo("bom.csv", "﻿a;b\n1;2");
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.linhas?.[0]).toBe("a;b");
    expect(conteudo?.abas?.[0].linhas[0][0]).toBe("a");
  });

  it("remove o BOM inicial de um .ts nas linhas", async () => {
    const { deps } = criarDeps();
    const r = arquivo("bom.ts", "﻿const a = 1;\nconst b = 2;");
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.linhas?.[0]).toBe("const a = 1;");
    expect(conteudo?.linhas?.[0].startsWith("﻿")).toBe(false);
  });

  it("lê as abas de um .xlsx válido", async () => {
    const { deps } = criarDeps();
    const r = arquivo("planilha.xlsx", await criarXlsx());
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.tipo).toBe("tabela");
    expect(conteudo?.abas?.map((a) => a.nome)).toEqual(["Clientes", "Notas"]);
    expect(conteudo?.abas?.[0].linhas[0]).toEqual(["Alfa", "7"]);
  });

  it("lê os parágrafos de um .docx válido", async () => {
    const { deps } = criarDeps();
    const r = arquivo("doc.docx", await criarDocx());
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.tipo).toBe("documento");
    expect(conteudo?.paragrafos?.length).toBeGreaterThan(0);
    expect(conteudo?.paragrafos?.[0]).toMatchObject({ texto: "Titulo", nivel: 1 });
  });

  it("devolve as páginas de um PDF com loader falso de 2 páginas", async () => {
    const { deps } = criarDeps(["primeira", "segunda"]);
    const r = arquivo("relatorio.pdf", "%PDF-falso");
    const conteudo = await carregarConteudo(r, deps);
    expect(conteudo?.tipo).toBe("documento");
    expect(conteudo?.paginas).toEqual(["primeira", "segunda"]);
  });

  it("na segunda chamada com o mesmo mtime e tamanho, usa o cache (1 chamada ao loader)", async () => {
    const { deps, chamadas } = criarDeps();
    const r = arquivo("cache.pdf", "%PDF-cache");
    const primeira = await carregarConteudo(r, deps);
    const segunda = await carregarConteudo(r, deps);
    expect(chamadas()).toBe(1);
    expect(segunda).toBe(primeira);
  });

  it("devolve undefined para extensão não suportada", async () => {
    const { deps, chamadas } = criarDeps();
    const r = arquivo("pacote.zip", "PK");
    expect(await carregarConteudo(r, deps)).toBeUndefined();
    expect(chamadas()).toBe(0);
  });

  it("devolve undefined sem ler o arquivo quando passa do limite de texto", async () => {
    const { deps } = criarDeps();
    const r = arquivo("grande.txt", "conteudo");
    const acima = { ...r, tamanho: LIMITE_TEXTO_BYTES + 1 };
    expect(await carregarConteudo(acima, deps)).toBeUndefined();
    expect(deps.cache.size).toBe(0);
  });

  it("devolve undefined sem chamar o loader quando o PDF passa do limite binário", async () => {
    const { deps, chamadas } = criarDeps();
    const r = arquivo("enorme.pdf", "%PDF");
    const acima = { ...r, tamanho: LIMITE_BINARIO_BYTES + 1 };
    expect(await carregarConteudo(acima, deps)).toBeUndefined();
    expect(chamadas()).toBe(0);
  });

  it("devolve undefined sem lançar quando o .xlsx está corrompido", async () => {
    const { deps } = criarDeps();
    const r = arquivo("quebrado.xlsx", new Uint8Array([1, 2, 3, 4, 5]));
    await expect(carregarConteudo(r, deps)).resolves.toBeUndefined();
    expect(deps.cache.size).toBe(0);
  });
});
