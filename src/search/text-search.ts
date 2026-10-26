// Line-based text search. Pure functions only: they work on strings and never touch the filesystem.
import { tipoDoArquivo } from "./extensions";
import { findEnclosingSymbol } from "./symbols";

export interface TrechoEncontrado {
  linha: number;
  trecho: string;
  simbolo_envolvente?: string;
}

const TAMANHO_MAX_TRECHO = 200;

// Lowercases, strips accents and trims. Used on both lines and search terms.
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Returns the lines that contain any of the terms, in file order, at most `opts.max` of them.
export function searchText(
  conteudo: string,
  termos: string[],
  opts: { extensao: string; max: number },
): TrechoEncontrado[] {
  const alvos = termos.map(normalizar).filter((t) => t !== "");
  if (alvos.length === 0) return [];

  const linhas = conteudo.split(/\r?\n/);
  const ehCodigo = tipoDoArquivo(opts.extensao) === "codigo";
  const resultado: TrechoEncontrado[] = [];

  for (let i = 0; i < linhas.length && resultado.length < opts.max; i++) {
    const normalizada = normalizar(linhas[i]);
    if (!alvos.some((t) => normalizada.includes(t))) continue;

    const achado: TrechoEncontrado = {
      linha: i + 1,
      trecho: linhas[i].trim().slice(0, TAMANHO_MAX_TRECHO),
    };
    if (ehCodigo) {
      const simbolo = findEnclosingSymbol(linhas, i, opts.extensao);
      if (simbolo !== undefined) achado.simbolo_envolvente = simbolo;
    }
    resultado.push(achado);
  }
  return resultado;
}
