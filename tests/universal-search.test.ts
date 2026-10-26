import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";
import { searchUniversal, type UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

function escrever(rel: string, conteudo: string | Uint8Array): void {
  const abs = path.join(pasta, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

// Workbook with the sheet "Resumo" and C15 = "Alfa".
async function criarXlsx(): Promise<Uint8Array> {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook ${NS} xmlns:r="${NS_R}"><sheets>` +
      `<sheet name="Resumo" sheetId="1" r:id="rId1"/>` +
      `</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="15"><c r="C15" t="inlineStr"><is><t>Alfa</t></is></c></row>` +
      `</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

// Document: a heading "Condicoes gerais" followed by a paragraph with "contrato".
async function criarDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Condicoes gerais</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>O contrato vale por um ano.</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const pdfLoader: PdfLoader = async () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async (n: number) => ({
        getTextContent: async () => ({
          items: [{ str: n === 2 ? "segunda pagina com garantia" : "primeira pagina" }],
        }),
      }),
    }),
  }),
});

function contexto(): UniversalContext {
  const conteudo: ConteudoDeps = { cache: new ContentCache<Conteudo>(), pdfLoader };
  return { basePath: pasta, excluidas: [], conteudo };
}

function buscar(termos: string[], extensoes: string[], limite = 50) {
  return searchUniversal({ termos, extensoes, pasta, recursivo: true, limite }, contexto());
}

beforeAll(async () => {
  escrever("src/a.ts", "export function soma(a: number, b: number): number {\n  const imposto = a * 0.1;\n  return a + b;\n}\n");
  escrever("node_modules/x.ts", "const imposto = 1;\n");
  escrever("notas.txt", "Anotacao geral sobre o projeto.\n");
  escrever("dados.csv", "id;cliente\n1;Alfa\n2;Outra");
  escrever("planilha.xlsx", await criarXlsx());
  escrever("contrato.docx", await criarDocx());
  escrever("r.pdf", new Uint8Array([37, 80, 68, 70]));
});

describe("searchUniversal", () => {
  it("acha o termo no codigo com o simbolo envolvente", async () => {
    const r = await buscar(["imposto"], ["ts"]);
    expect(r.total).toBe(1);
    expect(r.resultados).toHaveLength(1);
    const achado = r.resultados[0];
    expect(path.isAbsolute(achado.caminho)).toBe(true);
    expect(achado.caminho.endsWith("src/a.ts")).toBe(true);
    expect(achado.tipo).toBe("codigo");
    expect(achado.linha).toBe(2);
    expect(achado.simbolo_envolvente).toBe("soma");
  });

  it("acha a celula B2 de um csv com o nome do cabecalho da coluna", async () => {
    const r = await buscar(["Alfa"], ["csv"]);
    expect(r.resultados).toHaveLength(1);
    const achado = r.resultados[0];
    expect(achado).toMatchObject({
      tipo: "tabela",
      celula: "B2",
      linha: 2,
      coluna: "B",
      coluna_nome: "cliente",
      valor: "Alfa",
    });
  });

  it("acha a celula C15 de um xlsx com o nome da aba", async () => {
    const r = await buscar(["Alfa"], ["xlsx"]);
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0]).toMatchObject({
      celula: "C15",
      linha: 15,
      coluna: "C",
      aba: "Resumo",
    });
  });

  it("o trecho da linha inclui as celulas vazias com o nome da coluna", async () => {
    escrever("celulas-vazias.csv", "id;cliente;cidade\n1;;SP");
    const r = await buscar(["SP"], ["csv"]);
    const achado = r.resultados.find((x) => x.nome === "celulas-vazias.csv");
    expect(achado).toBeDefined();
    expect(achado?.trecho).toContain("cliente: ");
    expect(achado?.trecho).toContain("cidade: SP");
  });

  it("o trecho da linha curta inclui as colunas que faltam do cabecalho", async () => {
    escrever("linha-curta.csv", "id;cliente;cidade\n1;");
    const r = await buscar(["1"], ["csv"]);
    const achado = r.resultados.find((x) => x.nome === "linha-curta.csv");
    expect(achado).toBeDefined();
    expect(achado?.trecho).toContain("cliente: ");
    expect(achado?.trecho).toContain("cidade: ");
  });

  it("acha o paragrafo de um docx com a secao do titulo anterior", async () => {
    const r = await buscar(["contrato"], ["docx"]);
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0]).toMatchObject({
      tipo: "documento",
      secao_titulo: "Condicoes gerais",
    });
  });

  it("acha o termo na pagina 2 de um pdf", async () => {
    const r = await buscar(["garantia"], ["pdf"]);
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].pagina).toBe(2);
  });

  it("respeita o limite de resultados no total", async () => {
    const r = await buscar(["Alfa"], ["csv", "xlsx"], 1);
    expect(r.resultados).toHaveLength(1);
  });

  it("nao devolve arquivos dentro de node_modules", async () => {
    const r = await buscar(["imposto"], ["ts"]);
    expect(r.resultados.some((x) => x.caminho.includes("node_modules"))).toBe(false);
  });

  it("sem extensoes, devolve arquivos de tipos diferentes juntos", async () => {
    const r = await buscar(["Alfa", "contrato", "garantia"], []);
    const extensoes = new Set(r.resultados.map((x) => x.extensao));
    expect(extensoes.size).toBeGreaterThanOrEqual(2);
  });

  it("sem termos validos, devolve total 0 com dica", async () => {
    const r = await buscar(["  "], ["ts"]);
    expect(r.total).toBe(0);
    expect(r.dicas).toEqual(["Informe ao menos um termo"]);
  });
});

describe("searchUniversal com pastas excluidas e caminho absoluto", () => {
  const outro = fs.mkdtempSync(path.join(os.tmpdir(), "avs-fora-"));

  beforeAll(() => {
    escrever("Arquivo/velho.txt", "marcador-excl antigo\n");
    escrever("Vivo/novo.txt", "marcador-excl atual\n");
    fs.writeFileSync(path.join(outro, "Arquivo.txt"), "marcador-excl fora\n");
    fs.mkdirSync(path.join(outro, "Arquivo"), { recursive: true });
    fs.writeFileSync(path.join(outro, "Arquivo", "f.txt"), "marcador-excl fora2\n");
  });

  afterAll(() => {
    fs.rmSync(outro, { recursive: true, force: true });
  });

  const comExclusao = (pasta: string) =>
    searchUniversal(
      { termos: ["marcador-excl"], extensoes: ["txt"], pasta, recursivo: true, limite: 50 },
      { ...contexto(), excluidas: ["Arquivo"] },
    );

  it("caminho absoluto do cofre nao devolve arquivo de pasta excluida", async () => {
    const r = await comExclusao(pasta);
    const caminhos = r.resultados.map((x) => x.caminho);
    expect(caminhos.some((c) => c.endsWith("Vivo/novo.txt"))).toBe(true);
    expect(caminhos.some((c) => c.includes("Arquivo/"))).toBe(false);
  });

  it("caminho absoluto de uma pasta excluida devolve total 0", async () => {
    const r = await comExclusao(path.join(pasta, "Arquivo"));
    expect(r.total).toBe(0);
  });

  it("caminho absoluto fora do cofre nao sofre as exclusoes", async () => {
    const r = await comExclusao(outro);
    expect(r.resultados.some((x) => x.caminho.endsWith("Arquivo/f.txt"))).toBe(true);
    expect(r.resultados.some((x) => x.caminho.endsWith("Arquivo.txt"))).toBe(true);
  });
});
