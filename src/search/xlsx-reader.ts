// Reader for .xlsx files: a zip (JSZip) with XML parts, read with regular expressions.

import JSZip from "jszip";
import { columnIndex } from "./tabular-parser";
import { atributo, decodeXml } from "./xml-utils";

/** One sheet of the workbook. linhas[0] is row 1 of the sheet. */
export interface Aba {
  nome: string;
  linhas: string[][];
}

/** Text of every <t> element inside an XML fragment (decoded). */
function textosT(xml: string): string {
  let texto = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    texto += decodeXml(m[1] ?? "");
  }
  return texto;
}

/** Removes phonetic guide blocks (<rPh>), so only the base text of a string is kept. */
function semRph(xml: string): string {
  return xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
}

async function lerSharedStrings(zip: JSZip): Promise<string[]> {
  const arquivo = zip.file("xl/sharedStrings.xml");
  if (!arquivo) return [];
  const xml = await arquivo.async("string");
  const itens: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    itens.push(textosT(semRph(m[1] ?? "")));
  }
  return itens;
}

function valorCelula(tipo: string | undefined, corpo: string, sharedStrings: string[]): string {
  if (tipo === "inlineStr") {
    const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(corpo);
    return is ? textosT(semRph(is[1])) : "";
  }
  const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(corpo);
  const v = vm ? decodeXml(vm[1]) : "";
  if (tipo === "s") return sharedStrings[parseInt(v, 10)] ?? "";
  if (tipo === "b") return v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
  return v;
}

/** Turns the XML of one worksheet into rows. Gaps inside a row become "", empty rows become []. */
function lerLinhas(xml: string, sharedStrings: string[]): string[][] {
  const grade = new Map<number, Map<number, string>>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const tag = `<c${m[1]}>`;
    const ref = atributo(tag, "r");
    const pos = ref ? /^([A-Za-z]+)(\d+)$/.exec(ref) : null;
    if (!pos) continue;
    const coluna = columnIndex(pos[1]);
    const linha = parseInt(pos[2], 10);
    if (coluna < 0 || linha < 1) continue;
    const valor = valorCelula(atributo(tag, "t"), m[2] ?? "", sharedStrings);
    let celulas = grade.get(linha);
    if (!celulas) {
      celulas = new Map<number, string>();
      grade.set(linha, celulas);
    }
    // Celula vazia (sem valor) nao define a largura da linha: so valores diferentes de "" contam.
    if (valor !== "") celulas.set(coluna, valor);
  }

  let ultima = 0;
  for (const linha of grade.keys()) ultima = Math.max(ultima, linha);

  const linhas: string[][] = [];
  for (let n = 1; n <= ultima; n++) {
    const celulas = grade.get(n);
    if (!celulas || celulas.size === 0) {
      linhas.push([]);
      continue;
    }
    let maxColuna = 0;
    for (const c of celulas.keys()) maxColuna = Math.max(maxColuna, c);
    const linha: string[] = [];
    for (let c = 0; c <= maxColuna; c++) linha.push(celulas.get(c) ?? "");
    linhas.push(linha);
  }
  return linhas;
}

/** Reads every sheet of an .xlsx file, in workbook order. Throws "XLSX inválido" for a file that is not a valid zip/workbook. */
export async function parseXlsx(dados: Uint8Array | ArrayBuffer): Promise<Aba[]> {
  const zip = await JSZip.loadAsync(dados).catch(() => {
    throw new Error("XLSX inválido");
  });
  const workbook = zip.file("xl/workbook.xml");
  if (!workbook) throw new Error("XLSX inválido");

  const sharedStrings = await lerSharedStrings(zip);
  const workbookXml = await workbook.async("string");

  const relsArquivo = zip.file("xl/_rels/workbook.xml.rels");
  const relsXml = relsArquivo ? await relsArquivo.async("string") : "";
  const alvos = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = atributo(m[0], "Id");
    const target = atributo(m[0], "Target");
    if (id !== undefined && target !== undefined) alvos.set(id, target);
  }

  const abas: Aba[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const nome = decodeXml(atributo(tag, "name") ?? "");
    const alvo = alvos.get(atributo(tag, "r:id") ?? "");
    const caminho =
      alvo === undefined ? undefined : alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`;
    const arquivo = caminho ? zip.file(caminho) : null;
    const linhas = arquivo ? lerLinhas(await arquivo.async("string"), sharedStrings) : [];
    abas.push({ nome, linhas });
  }
  return abas;
}
