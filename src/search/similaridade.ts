// Finds names close to a requested one, to suggest them in error hints.
import { normalizar } from "./text-search";

// Classic Levenshtein distance between the normalized texts.
export function distancia(a: string, b: string): number {
  const s = normalizar(a);
  const t = normalizar(b);
  let anterior = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const atual: number[] = [i];
    for (let j = 1; j <= t.length; j++) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
    }
    anterior = atual;
  }
  return anterior[t.length];
}

// Normalized text without leading or trailing slashes.
function aparar(texto: string): string {
  return normalizar(texto).replace(/^\/+|\/+$/g, "");
}

// Candidates that contain the target (or are contained by it) rank first, then by edit distance.
export function maisParecidos(alvo: string, candidatos: readonly string[], max = 5): string[] {
  const a = aparar(alvo);
  if (a === "") return [];

  const vistos = new Set<string>();
  const pontuados: { original: string; nota: number }[] = [];
  for (const original of candidatos) {
    if (vistos.has(original)) continue;
    vistos.add(original);

    const n = aparar(original);
    // An empty name is never a useful suggestion.
    if (n === "") continue;
    if (n.includes(a) || a.includes(n)) {
      pontuados.push({ original, nota: Math.abs(n.length - a.length) / 100 });
      continue;
    }
    const d = distancia(a, n);
    if (d <= Math.max(2, Math.floor(a.length / 3))) {
      pontuados.push({ original, nota: d });
    }
  }

  pontuados.sort((x, y) => x.nota - y.nota || x.original.localeCompare(y.original));
  return pontuados.slice(0, max).map((p) => p.original);
}
