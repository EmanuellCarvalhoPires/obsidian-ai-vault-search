import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo } from "../src/search/file-content";
import type { PdfLoader } from "../src/search/pdf-reader";
import { readTable } from "../src/search/read-table";
import type { UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const pdfLoader: PdfLoader = async () => {
  throw new Error("pdf nao usado neste teste");
};

function contexto(): UniversalContext {
  return {
    basePath: pasta,
    excluidas: [],
    conteudo: { cache: new ContentCache<Conteudo>(), pdfLoader },
  };
}

// Minimal xlsx: sheet "Clientes" (id, cliente, valor) and sheet "Notas" (one cell), with inline strings.
async function criarXlsx(): Promise<Uint8Array> {
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
      `<row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c>` +
      `<c r="B1" t="inlineStr"><is><t>cliente</t></is></c>` +
      `<c r="C1" t="inlineStr"><is><t>valor</t></is></c></row>` +
      `<row r="2"><c r="A2"><v>1</v></c>` +
      `<c r="B2" t="inlineStr"><is><t>Alfa</t></is></c><c r="C2"><v>10</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Texto da nota</t></is></c></row>` +
      `</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

beforeAll(async () => {
  fs.writeFileSync(path.join(pasta, "dados.csv"), "id,cliente,valor\n1,Alfa,10\n2,Beta,20\n3,Gama,30\n");
  fs.writeFileSync(path.join(pasta, "anotacao.txt"), "texto simples");
  fs.writeFileSync(path.join(pasta, "planilha.xlsx"), await criarXlsx());
});

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe("readTable", () => {
  it("csv sem opcoes: markdown com cabecalho # + colunas e 3 linhas", async () => {
    const r = await readTable({ arquivo: path.join(pasta, "dados.csv") }, contexto());
    expect(r.formato).toBe("markdown");
    expect(r.total_linhas).toBe(3);
    const linhas = (r.tabela as string).split("\n");
    expect(linhas[0]).toBe("| # | id | cliente | valor |");
    expect(linhas.length).toBe(2 + 3);
  });

  it("colunas [cliente, C]: so cliente e valor aparecem", async () => {
    const r = await readTable(
      { arquivo: "dados.csv", colunas: ["cliente", "C"] },
      contexto(),
    );
    expect(r.colunas).toEqual(["cliente", "valor"]);
    const cabecalho = (r.tabela as string).split("\n")[0];
    expect(cabecalho).toBe("| # | cliente | valor |");
    expect(cabecalho).not.toContain("id");
  });

  it("cabecalho id com colunas [id]: devolve a coluna id, nao a coluna I", async () => {
    fs.writeFileSync(path.join(pasta, "ponto-e-virgula.csv"), "id;cliente;valor\n7;Alfa;70\n");
    const r = await readTable({ arquivo: "ponto-e-virgula.csv", colunas: ["id"] }, contexto());
    expect(r.colunas).toEqual(["id"]);
    const linhas = (r.tabela as string).split("\n");
    expect(linhas[0]).toBe("| # | id |");
    expect(linhas[2]).toBe("| 2 | 7 |");
    expect(r.dicas).toBeUndefined();
  });

  it("colunas [B] sem cabecalho B: continua valendo como letra (cliente)", async () => {
    const r = await readTable({ arquivo: "ponto-e-virgula.csv", colunas: ["B"] }, contexto());
    expect(r.colunas).toEqual(["cliente"]);
    const linhas = (r.tabela as string).split("\n");
    expect(linhas[2]).toBe("| 2 | Alfa |");
  });

  it("linha_inicio 3 e linha_fim 3: so a linha 3 da planilha (id 2) com o cabecalho", async () => {
    const r = await readTable(
      { arquivo: path.join(pasta, "dados.csv"), linha_inicio: 3, linha_fim: 3 },
      contexto(),
    );
    const linhas = (r.tabela as string).split("\n");
    expect(linhas[0]).toBe("| # | id | cliente | valor |");
    expect(linhas.length).toBe(3);
    expect(linhas[2]).toBe("| 3 | 2 | Beta | 20 |");
    expect(r.linha_inicio).toBe(3);
    expect(r.linha_fim).toBe(3);
  });

  it("formato json: array com _linha 2 e cliente Alfa no primeiro item", async () => {
    const r = await readTable(
      { arquivo: path.join(pasta, "dados.csv"), formato: "json" },
      contexto(),
    );
    const tabela = r.tabela as Array<Record<string, unknown>>;
    expect(Array.isArray(tabela)).toBe(true);
    expect(tabela[0]._linha).toBe(2);
    expect(tabela[0].cliente).toBe("Alfa");
  });

  it("formato csv: cabecalho e linhas com valores com virgula entre aspas", async () => {
    const r = await readTable({ arquivo: path.join(pasta, "dados.csv"), formato: "csv" }, contexto());
    expect((r.tabela as string).split("\n")[0]).toBe("id,cliente,valor");
  });

  it("xlsx de duas abas sem aba: usa a primeira e lista as duas", async () => {
    const r = await readTable({ arquivo: path.join(pasta, "planilha.xlsx") }, contexto());
    expect(r.aba).toBe("Clientes");
    expect(r.abas).toEqual(["Clientes", "Notas"]);
    expect(r.total_linhas).toBe(1);
  });

  it("aba inexistente: dica Aba nao encontrada", async () => {
    const r = await readTable({ arquivo: "planilha.xlsx", aba: "inexistente" }, contexto());
    expect(r.dicas).toEqual(["Aba não encontrada"]);
    expect(r.abas).toEqual(["Clientes", "Notas"]);
  });

  it("arquivo .txt: dica Use arquivo csv, tsv ou xlsx", async () => {
    const r = await readTable({ arquivo: "anotacao.txt" }, contexto());
    expect(r.total_linhas).toBe(0);
    expect(r.dicas).toEqual(["Use arquivo .csv, .tsv ou .xlsx"]);
  });

  it("arquivo inexistente: dica Arquivo nao encontrado", async () => {
    const r = await readTable({ arquivo: "nao-existe.csv" }, contexto());
    expect(r.total_linhas).toBe(0);
    expect(r.dicas).toEqual(["Arquivo não encontrado: nao-existe.csv"]);
  });
});
