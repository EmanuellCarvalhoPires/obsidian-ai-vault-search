// Reader for .docx files: a zip (JSZip) whose word/document.xml is read with regular expressions.

import JSZip from "jszip";
import { atributo, decodeXml } from "./xml-utils";

/** One paragraph of the document. indice is 1-based and counts empty paragraphs too. */
export interface Paragrafo {
  indice: number;
  texto: string;
  estilo?: string;
  nivel?: number;
}

// Self-closing empty paragraphs (<w:p/>, <w:p w14:paraId="1"/>) come first so they are not swallowed by the next paragraph.
const PARAGRAFO = /<w:p(?:\s[^>]*?)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const PARTE_TEXTO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:br(?:\s[^>]*)?\/>/g;
const ESTILO_NIVEL = /^(?:Heading|Ttulo|Título)\s*(\d)$/i;

/** Text of one paragraph: <w:t> runs in order, <w:tab/> as tab and <w:br/> as newline. */
function textoDoParagrafo(xml: string): string {
  let texto = "";
  for (const m of xml.matchAll(PARTE_TEXTO)) {
    if (m[1] !== undefined) {
      texto += decodeXml(m[1]);
    } else if (m[0].startsWith("<w:tab")) {
      texto += "\t";
    } else {
      texto += "\n";
    }
  }
  return texto;
}

/** Reads the paragraphs of a .docx file, in document order. Throws "DOCX inválido" for a file that is not a valid docx. */
export async function parseDocx(dados: Uint8Array | ArrayBuffer): Promise<Paragrafo[]> {
  const zip = await JSZip.loadAsync(dados).catch(() => {
    throw new Error("DOCX inválido");
  });
  const documento = zip.file("word/document.xml");
  if (!documento) throw new Error("DOCX inválido");
  const xml = await documento.async("string");

  const paragrafos: Paragrafo[] = [];
  let indice = 0;
  for (const m of xml.matchAll(PARAGRAFO)) {
    indice++;
    const corpo = m[0];
    const texto = textoDoParagrafo(corpo);
    if (texto === "") continue;

    const paragrafo: Paragrafo = { indice, texto };
    const pStyle = /<w:pStyle\b[^>]*>/.exec(corpo);
    const estilo = pStyle ? atributo(pStyle[0], "w:val") : undefined;
    if (estilo !== undefined) {
      paragrafo.estilo = estilo;
      const nivel = ESTILO_NIVEL.exec(estilo);
      if (nivel) paragrafo.nivel = parseInt(nivel[1], 10);
    }
    paragrafos.push(paragrafo);
  }
  return paragrafos;
}
