import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseDocx } from "../src/search/docx-reader";

const DOCUMENTO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introdução</w:t></w:r></w:p>
<w:p><w:r><w:t>Texto normal</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Detalhes</w:t></w:r></w:p>
<w:p><w:pPr></w:pPr></w:p>
</w:body>
</w:document>`;

async function criarDocx(xml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array" });
}

describe("parseDocx", () => {
  it("descarta o parágrafo vazio e devolve estilo e nível dos títulos", async () => {
    const paragrafos = await parseDocx(await criarDocx(DOCUMENTO));
    expect(paragrafos).toHaveLength(3);
    expect(paragrafos[0]).toMatchObject({ texto: "Introdução", nivel: 1, estilo: "Heading1" });
  });

  it("mantém o índice contando os parágrafos vazios", async () => {
    const paragrafos = await parseDocx(await criarDocx(DOCUMENTO));
    const detalhes = paragrafos.find((p) => p.texto === "Detalhes");
    expect(detalhes?.indice).toBe(3);
    expect(detalhes?.nivel).toBe(2);
  });

  it("decodifica entidades XML no texto", async () => {
    const xml = `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:body></w:document>`;
    const paragrafos = await parseDocx(await criarDocx(xml));
    expect(paragrafos[0].texto).toBe("A & B");
  });

  it.each([
    ["com atributos (w14:paraId)", '<w:p w14:paraId="1"/>'],
    ["sem atributos", "<w:p/>"],
  ])("conta o parágrafo vazio autofechado %s no índice", async (_nome, vazio) => {
    const xml =
      `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p>${vazio}` +
      `<w:p><w:r><w:t>C</w:t></w:r></w:p><w:p><w:r><w:t>D</w:t></w:r></w:p></w:body></w:document>`;
    const paragrafos = await parseDocx(await criarDocx(xml));
    expect(paragrafos.map((p) => [p.texto, p.indice])).toEqual([
      ["A", 1],
      ["C", 3],
      ["D", 4],
    ]);
  });

  it("rejeita bytes que não são um docx", async () => {
    await expect(parseDocx(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow("DOCX inválido");
  });
});
