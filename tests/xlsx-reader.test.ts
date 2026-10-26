import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseXlsx } from "../src/search/xlsx-reader";
import { atributo, decodeXml } from "../src/search/xml-utils";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Minimal xlsx: two sheets, shared strings (plain, entity and rich text) and inline strings. */
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
      `<Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<sst ${NS}>` +
      `<si><t>id</t></si>` +
      `<si><t>nome</t></si>` +
      `<si><t>Alfa</t></si>` +
      `<si><t>Tom &amp; Jerry</t></si>` +
      `<si><r><t>Ola </t></r><r><t>mundo</t></r></si>` +
      `</sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2"><v>2</v></c><c r="B2" t="s"><v>2</v></c></row>` +
      `<row r="3"><c r="D3"><v>99</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet ${NS}><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Texto inline</t></is></c>` +
      `<c r="B1" t="s"><v>3</v></c><c r="C1" s="1"/><c r="D1"><v>5</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3" t="b"><v>1</v></c>` +
      `<c r="D3" t="b"><v>0</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("xml-utils", () => {
  it("decodifica entidades nomeadas e numéricas em uma passada", () => {
    expect(decodeXml("&#233;&#x41;&lt;&apos;&quot;")).toBe("éA<'\"");
    expect(decodeXml("&amp;lt;")).toBe("&lt;");
  });

  it("le o atributo com e sem prefixo de namespace", () => {
    const tag = '<Relationship r:id="rId9" Id="x"/>';
    expect(atributo(tag, "r:id")).toBe("rId9");
    expect(atributo(tag, "Id")).toBe("x");
    expect(atributo(tag, "Target")).toBeUndefined();
  });
});

describe("parseXlsx", () => {
  it("devolve 2 abas com esses nomes na ordem do workbook", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas.length).toBe(2);
    expect(abas.map((a) => a.nome)).toEqual(["Clientes", "Notas"]);
  });

  it("le shared strings e numeros da aba Clientes", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[0].linhas.slice(0, 2)).toEqual([
      ["id", "nome"],
      ["2", "Alfa"],
    ]);
  });

  it("preenche com vazio as celulas antes de uma celula preenchida", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[0].linhas[2]).toEqual(["", "", "", "99"]);
  });

  it("le celula inlineStr e celula vazia autofechada", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[1].linhas[0]).toEqual(["Texto inline", "Tom & Jerry", "", "5"]);
  });

  it("decodifica entidades nas shared strings", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[1].linhas[0][1]).toBe("Tom & Jerry");
  });

  it("concatena os <t> de uma shared string em rich text", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[1].linhas[2][0]).toBe("Ola mundo");
  });

  it("linha vazia no meio vira []", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[1].linhas[1]).toEqual([]);
  });

  it("converte booleanos em TRUE e FALSE", async () => {
    const abas = await parseXlsx(await criarXlsx());
    expect(abas[1].linhas[2]).toEqual(["Ola mundo", "", "TRUE", "FALSE"]);
  });

  it("aceita ArrayBuffer como entrada", async () => {
    const bytes = await criarXlsx();
    const abas = await parseXlsx(bytes.slice().buffer);
    expect(abas[0].nome).toBe("Clientes");
  });

  it("rejeita bytes que nao sao um xlsx com 'XLSX inválido'", async () => {
    const aleatorio = new Uint8Array(256);
    for (let i = 0; i < aleatorio.length; i++) aleatorio[i] = (i * 73 + 41) % 256;
    await expect(parseXlsx(aleatorio)).rejects.toThrow("XLSX inválido");
  });

  it("ignora o texto fonetico <rPh> de shared strings e de inlineStr", async () => {
    // Dado uma planilha cuja shared string tem texto base "東京" e guia fonetica "トウキョウ",
    // quando a aba e lida, entao a celula traz so "東京" (sem a parte <rPh>).
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<workbook ${NS} xmlns:r="${NS_R}"><sheets><sheet name="Cidades" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/sharedStrings.xml",
      `<sst ${NS}><si><r><t>東京</t></r><rPh sb="0" eb="2"><t>トウキョウ</t></rPh>` +
        `<phoneticPr fontId="1" type="noConversion"/></si></sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet ${NS}><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c>` +
        `<c r="B1" t="inlineStr"><is><t>大阪</t><rPh sb="0" eb="2"><t>オオサカ</t></rPh></is></c></row>` +
        `</sheetData></worksheet>`,
    );
    const abas = await parseXlsx(await zip.generateAsync({ type: "uint8array" }));
    expect(abas[0].linhas[0]).toEqual(["東京", "大阪"]);
  });

  it("celula vazia estilizada no fim da linha nao estende a largura", async () => {
    // Dado A1 preenchida e C1 vazia com estilo (<c r="C1" s="1"/>),
    // quando a aba e lida, entao a linha 1 traz so ["x"].
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<workbook ${NS} xmlns:r="${NS_R}"><sheets><sheet name="Estilo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet ${NS}><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="C1" s="1"/></row>` +
        `</sheetData></worksheet>`,
    );
    const abas = await parseXlsx(await zip.generateAsync({ type: "uint8array" }));
    expect(abas[0].linhas[0]).toEqual(["x"]);
  });
});
