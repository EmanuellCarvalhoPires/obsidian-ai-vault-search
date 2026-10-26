// Parser for CSV/TSV text and helpers for spreadsheet-style cell references.

const DELIMITADORES = [",", ";", "\t"];

/** Column letter for a 0-based index: 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(indice0: number): string {
  let letras = "";
  let n = indice0 + 1;
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/** Inverse of columnLetter; case-insensitive. Returns -1 when invalid. */
export function columnIndex(letra: string): number {
  const maiuscula = letra.toUpperCase();
  if (!/^[A-Z]+$/.test(maiuscula)) return -1;
  let valor = 0;
  for (let i = 0; i < maiuscula.length; i++) {
    valor = valor * 26 + (maiuscula.charCodeAt(i) - 64);
  }
  return valor - 1;
}

/** Cell reference from a 0-based column and a 1-based line: cellRef(1, 14) = "B14". */
export function cellRef(coluna0: number, linha1: number): string {
  return `${columnLetter(coluna0)}${linha1}`;
}

/** Counts candidate delimiters on the first non-empty record, outside quotes. */
function contarDelimitadores(texto: string): Record<string, number> {
  const contagem: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let dentroAspas = false;
  let iniciou = false;
  for (const ch of texto) {
    if (ch === '"') {
      dentroAspas = !dentroAspas;
      iniciou = true;
      continue;
    }
    if (!dentroAspas && (ch === "\n" || ch === "\r")) {
      if (iniciou) break;
      continue;
    }
    if (!dentroAspas && ch in contagem) {
      contagem[ch] = (contagem[ch] ?? 0) + 1;
      iniciou = true;
    } else if (ch !== " " && ch !== "\t") {
      iniciou = true;
    }
  }
  return contagem;
}

/** Picks the delimiter with the highest count; ties or zero fall back to ",". */
function detectarDelimitador(texto: string): string {
  const contagem = contarDelimitadores(texto);
  let melhor = ",";
  let maximo = 0;
  let empate = false;
  for (const delimitador of DELIMITADORES) {
    const valor = contagem[delimitador] ?? 0;
    if (valor > maximo) {
      maximo = valor;
      melhor = delimitador;
      empate = false;
    } else if (valor === maximo && valor > 0) {
      empate = true;
    }
  }
  return maximo === 0 || empate ? "," : melhor;
}

/** Parses CSV/TSV text into rows of strings; supports quoted fields and BOM. */
export function parseDelimited(texto: string): {
  delimitador: string;
  linhas: string[][];
} {
  const semBom = texto.startsWith("﻿") ? texto.slice(1) : texto;
  const delimitador = detectarDelimitador(semBom);

  const linhas: string[][] = [];
  // Blank lines wait here: they only count if a non-blank record follows them.
  const pendentes: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let dentroAspas = false;
  let temConteudo = false;

  const fecharLinha = (): void => {
    linha.push(campo);
    if (temConteudo) {
      for (const vazia of pendentes) linhas.push(vazia);
      pendentes.length = 0;
      linhas.push(linha);
    } else {
      pendentes.push(linha);
    }
    linha = [];
    campo = "";
    temConteudo = false;
  };

  for (let i = 0; i < semBom.length; i++) {
    const ch = semBom[i] ?? "";
    if (ch !== "\n" && ch !== "\r") temConteudo = true;
    if (dentroAspas) {
      if (ch === '"') {
        if (semBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }
    if (ch === '"' && campo === "") {
      dentroAspas = true;
    } else if (ch === delimitador) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\r" && semBom[i + 1] === "\n") {
      continue;
    } else if (ch === "\n" || ch === "\r") {
      fecharLinha();
    } else {
      campo += ch;
    }
  }

  // Flush the last record unless the text ended with a line break.
  // Trailing blank lines (pendentes) are dropped on purpose.
  if (temConteudo) {
    fecharLinha();
  }

  return { delimitador, linhas };
}
