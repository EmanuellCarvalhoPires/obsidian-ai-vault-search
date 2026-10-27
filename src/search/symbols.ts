// Symbol detection for source code: functions, classes, interfaces, types and methods.
// Pure functions only: they work on strings and never touch the filesystem.

export interface Simbolo {
  nome: string;
  tipo: "funcao" | "classe" | "interface" | "tipo" | "metodo";
  linha: number;
}

type TipoSimbolo = Simbolo["tipo"];
type Familia = "chaves" | "indentacao";

interface Regra {
  re: RegExp;
  tipo: TipoSimbolo;
}

const CHAVES = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "rs", "java", "cs", "c", "cpp", "h",
  "php", "kt", "swift", "css",
]);
const INDENTACAO = new Set(["py"]);

// Declarations for brace-based languages, tested line by line.
const DECLARACOES_CHAVES: readonly Regra[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, tipo: "funcao" },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, tipo: "classe" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, tipo: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, tipo: "tipo" },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, tipo: "funcao" },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, tipo: "funcao" },
  { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, tipo: "funcao" },
];

// Method declared with indentation, e.g. "  dobro(x: number) {".
const METODO_CHAVES =
  /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/;
const PALAVRAS_NAO_METODO = new Set(["if", "for", "while", "switch", "catch", "return", "function"]);

// Declarations for Python, where the block is defined by indentation.
const DEF_PY = /^\s*(?:async\s+)?def\s+(\w+)/;
const CLASS_PY = /^\s*class\s+(\w+)/;

function normalizarExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\.+/, "");
}

function familia(ext: string): Familia | undefined {
  const e = normalizarExt(ext);
  if (CHAVES.has(e)) return "chaves";
  if (INDENTACAO.has(e)) return "indentacao";
  return undefined;
}

function larguraIndentacao(linha: string): number {
  return linha.length - linha.trimStart().length;
}

// Detects a symbol declared on one line. Returns undefined when the line declares nothing.
function detectar(linha: string, ext: string): { nome: string; tipo: TipoSimbolo } | undefined {
  const e = normalizarExt(ext);
  const indentada = larguraIndentacao(linha) > 0;

  if (CHAVES.has(e)) {
    for (const regra of DECLARACOES_CHAVES) {
      const m = regra.re.exec(linha);
      if (m) return { nome: m[1], tipo: regra.tipo };
    }
    if (indentada) {
      const m = METODO_CHAVES.exec(linha);
      if (m && !PALAVRAS_NAO_METODO.has(m[1])) return { nome: m[1], tipo: "metodo" };
    }
    return undefined;
  }

  if (INDENTACAO.has(e)) {
    const def = DEF_PY.exec(linha);
    if (def) return { nome: def[1], tipo: indentada ? "metodo" : "funcao" };
    const cls = CLASS_PY.exec(linha);
    if (cls) return { nome: cls[1], tipo: "classe" };
  }
  return undefined;
}

// Lists the symbols declared in the content. Unsupported extensions return an empty list.
export function listSymbols(conteudo: string, ext: string): Simbolo[] {
  if (familia(ext) === undefined) return [];
  const simbolos: Simbolo[] = [];
  conteudo.split(/\r?\n/).forEach((linha, i) => {
    const achado = detectar(linha, ext);
    if (achado) simbolos.push({ nome: achado.nome, tipo: achado.tipo, linha: i + 1 });
  });
  return simbolos;
}

// Name of the closest symbol declared at or above `indice` (0-based).
export function findEnclosingSymbol(linhas: readonly string[], indice: number, ext: string): string | undefined {
  if (familia(ext) === undefined) return undefined;
  for (let i = Math.min(indice, linhas.length - 1); i >= 0; i--) {
    const achado = detectar(linhas[i], ext);
    if (achado) return achado.nome;
  }
  return undefined;
}

// Last line (0-based) of a brace block that starts at `inicio`.
// The signature is read first: braces inside its parentheses (e.g. an inline object type
// in a parameter) are ignored, and brace counting starts at the first "{" outside them.
// Strings ("...", '...', `...` with "\" escapes), line comments (//) and block comments
// (/* ... */, possibly multiline) are skipped. In Rust ("rs") the apostrophe is a lifetime
// or char marker, so it never opens a string there.
// Known limitations: regex literals (e.g. /}/) and template literals with nested ${ ... }
// containing backticks or braces are not understood; double-quoted strings are assumed to
// end on the same line.
function fimBlocoChaves(linhas: string[], inicio: number, ext = ""): number {
  const apostrofoEhString = normalizarExt(ext) !== "rs";
  let profundidade = 0;
  let parenteses = 0;
  let abriu = false;
  let emBloco = false; // inside /* ... */
  let emTemplate = false; // inside `...` (may span lines)
  for (let j = inicio; j < linhas.length; j++) {
    const linha = linhas[j];
    let codigo = ""; // the line with strings and comments removed
    let aspas: string | undefined = emTemplate ? "`" : undefined;
    for (let k = 0; k < linha.length; k++) {
      const c = linha[k];
      if (emBloco) {
        if (c === "*" && linha[k + 1] === "/") {
          emBloco = false;
          k++;
        }
        continue;
      }
      if (aspas !== undefined) {
        if (c === "\\") k++;
        else if (c === aspas) aspas = undefined;
        continue;
      }
      if (c === "/" && linha[k + 1] === "/") break;
      if (c === "/" && linha[k + 1] === "*") {
        emBloco = true;
        k++;
        continue;
      }
      if (c === '"' || c === "`" || (c === "'" && apostrofoEhString)) {
        aspas = c;
        continue;
      }
      codigo += c;
    }
    emTemplate = aspas === "`";
    for (const c of codigo) {
      if (!abriu) {
        // Still in the signature: only track parentheses and the first "{" outside them.
        if (c === "(") parenteses++;
        else if (c === ")") parenteses--;
        else if (c === "{" && parenteses === 0) {
          abriu = true;
          profundidade++;
        }
      } else if (c === "{") {
        profundidade++;
      } else if (c === "}") {
        profundidade--;
      }
    }
    if (abriu && profundidade === 0) return j;
    // Declaration ended with ";" before any "{" (type alias, one-line interface, arrow without braces).
    // A ";" inside the parentheses of a multiline signature does not end the declaration.
    if (!abriu && parenteses === 0 && codigo.includes(";")) return j;
  }
  return linhas.length - 1;
}

// Last line (0-based) of an indentation block that starts at `inicio`.
function fimBlocoIndentacao(linhas: string[], inicio: number): number {
  const indentDeclaracao = larguraIndentacao(linhas[inicio]);
  let ultimo = inicio;
  for (let j = inicio + 1; j < linhas.length; j++) {
    if (linhas[j].trim() === "") continue;
    if (larguraIndentacao(linhas[j]) <= indentDeclaracao) break;
    ultimo = j;
  }
  return ultimo;
}

// Extracts the full block of a symbol. Exact name first, then case-insensitive.
export function extractSymbolBlock(
  conteudo: string,
  ext: string,
  nome: string,
): { nome: string; linha_inicio: number; linha_fim: number; conteudo: string } | undefined {
  const fam = familia(ext);
  if (fam === undefined) return undefined;

  const simbolos = listSymbols(conteudo, ext);
  const alvo =
    simbolos.find((s) => s.nome === nome) ??
    simbolos.find((s) => s.nome.toLowerCase() === nome.toLowerCase());
  if (alvo === undefined) return undefined;

  const linhas = conteudo.split(/\r?\n/);
  const inicio = alvo.linha - 1;
  const fim = fam === "chaves" ? fimBlocoChaves(linhas, inicio, ext) : fimBlocoIndentacao(linhas, inicio);

  return {
    nome: alvo.nome,
    linha_inicio: alvo.linha,
    linha_fim: fim + 1,
    conteudo: linhas.slice(inicio, fim + 1).join("\n"),
  };
}
