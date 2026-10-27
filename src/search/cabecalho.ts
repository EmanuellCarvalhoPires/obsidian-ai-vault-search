// Picks the heading that best matches a requested title.
import { normalizar } from "./text-search";

// Score: 4 exact, 3 prefix on a whole word, 2 prefix, 1 contains, 0 no match.
function pontuar(titulo: string, alvo: string): number {
  if (titulo === alvo) return 4;
  if (titulo.startsWith(alvo)) {
    const seguinte = titulo.charAt(alvo.length);
    return seguinte === "" || !/[a-z0-9]/.test(seguinte) ? 3 : 2;
  }
  return titulo.includes(alvo) ? 1 : 0;
}

export function escolherCabecalho<T>(itens: readonly T[], titulo: (item: T) => string, alvo: string): T | undefined {
  const a = normalizar(alvo);
  if (a === "") return undefined;

  let melhor: T | undefined;
  let melhorPontos = 0;
  for (const item of itens) {
    const pontos = pontuar(normalizar(titulo(item)), a);
    // Strictly greater: on a tie the first heading in document order wins.
    if (pontos > melhorPontos) {
      melhor = item;
      melhorPontos = pontos;
    }
  }
  return melhor;
}
