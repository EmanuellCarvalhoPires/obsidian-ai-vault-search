import { isAbsolutePath } from "./path-resolver";

export type TipoArquivo = "nota" | "codigo" | "texto" | "tabela" | "documento" | "outro";

const CODIGO = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "cs", "c", "cpp", "h",
  "rb", "php", "sh", "ps1", "css", "html", "sql", "kt", "swift",
]);
const TEXTO = new Set(["txt", "json", "yaml", "yml", "xml", "log", "ini", "toml"]);
const TABELA = new Set(["csv", "tsv", "xlsx"]);
const DOCUMENTO = new Set(["pdf", "docx"]);

// Merges `extensoes` and `extensao` (comma-separated) into normalized extensions without dot.
// "*" means every extension, returned as an empty list.
export function parseExtensions(extensoes?: string[], extensao?: string): string[] {
  const brutos: string[] = [...(extensoes ?? [])];
  if (extensao !== undefined) {
    brutos.push(...extensao.split(","));
  }
  const resultado: string[] = [];
  for (const bruto of brutos) {
    const ext = bruto.trim().replace(/^\.+/, "").toLowerCase();
    if (ext === "") {
      continue;
    }
    if (ext === "*") {
      return [];
    }
    if (!resultado.includes(ext)) {
      resultado.push(ext);
    }
  }
  return resultado;
}

// Classifies a file extension (without dot, any case) into a file type.
export function tipoDoArquivo(ext: string): TipoArquivo {
  const e = ext.trim().toLowerCase();
  if (e === "md") return "nota";
  if (CODIGO.has(e)) return "codigo";
  if (TEXTO.has(e)) return "texto";
  if (TABELA.has(e)) return "tabela";
  if (DOCUMENTO.has(e)) return "documento";
  return "outro";
}

// A request is universal when it targets an absolute folder or asks for a non-markdown extension.
export function isUniversalRequest(pasta: string | undefined, exts: string[]): boolean {
  if (pasta !== undefined && isAbsolutePath(pasta.trim())) {
    return true;
  }
  return exts.some((e) => e.trim().toLowerCase() !== "md");
}
