// In-memory inverted index scored with BM25, weighted by field (title > tags > up > body).
// Pure: no disk and no Obsidian access. The search engine keeps it in sync with the vault.
import { normalizar } from "./text-search";

export interface CamposDocumento {
  titulo: string;
  tags: string;
  up: string;
  corpo: string;
}

// Each variant is one normalized word. Empty variants are ignored.
export interface TermoConsulta {
  variantes: string[];
}

export interface OpcoesPontuacao {
  exato: boolean;
  candidatos?: ReadonlySet<string>;
}

type Campo = keyof CamposDocumento;

const PESOS: Record<Campo, number> = { titulo: 3, tags: 1.5, up: 1, corpo: 1 };
const K1 = 1.2;
const B = 0.75;

export function tokenizar(texto: string): string[] {
  return normalizar(texto).match(/[a-z0-9]+/g) ?? [];
}

interface DocumentoIndexado {
  comprimento: number;
  tokens: string[];
}

function casa(token: string, variantes: string[], exato: boolean): boolean {
  return exato ? variantes.includes(token) : variantes.some((v) => token.includes(v));
}

export class IndiceBm25 {
  // token -> (document id -> weighted term frequency)
  private readonly invertido = new Map<string, Map<string, number>>();
  private readonly docs = new Map<string, DocumentoIndexado>();
  private somaComprimentos = 0;

  get tamanho(): number {
    return this.docs.size;
  }

  tem(id: string): boolean {
    return this.docs.has(id);
  }

  atualizar(id: string, campos: CamposDocumento): void {
    this.remover(id);

    const tf = new Map<string, number>();
    let comprimento = 0;
    for (const campo of Object.keys(PESOS) as Campo[]) {
      const tokens = tokenizar(campos[campo]);
      // Length counts every token without weight; only the frequency is weighted.
      comprimento += tokens.length;
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + PESOS[campo]);
      }
    }

    for (const [token, peso] of tf) {
      let porDoc = this.invertido.get(token);
      if (!porDoc) {
        porDoc = new Map<string, number>();
        this.invertido.set(token, porDoc);
      }
      porDoc.set(id, peso);
    }
    this.docs.set(id, { comprimento, tokens: [...tf.keys()] });
    this.somaComprimentos += comprimento;
  }

  remover(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const token of doc.tokens) {
      const porDoc = this.invertido.get(token);
      if (!porDoc) continue;
      porDoc.delete(id);
      if (porDoc.size === 0) this.invertido.delete(token);
    }
    this.docs.delete(id);
    this.somaComprimentos -= doc.comprimento;
  }

  // Terms are ORed: a document scores if any term matches it.
  pontuar(termos: TermoConsulta[], opcoes: OpcoesPontuacao): Map<string, number> {
    const pontuacao = new Map<string, number>();
    const n = this.docs.size;
    if (n === 0) return pontuacao;
    const media = this.somaComprimentos / n;

    for (const termo of termos) {
      const variantes = termo.variantes.filter((v) => v !== "");
      if (variantes.length === 0) continue;

      // Sum the weighted frequency over every vocabulary token that matches a variant.
      const tfPorDoc = new Map<string, number>();
      for (const [token, porDoc] of this.invertido) {
        if (!casa(token, variantes, opcoes.exato)) continue;
        for (const [id, tf] of porDoc) {
          tfPorDoc.set(id, (tfPorDoc.get(id) ?? 0) + tf);
        }
      }

      // df and N are always global, even when candidatos restricts the output.
      const df = tfPorDoc.size;
      if (df === 0) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));

      for (const [id, tf] of tfPorDoc) {
        if (opcoes.candidatos && !opcoes.candidatos.has(id)) continue;
        const doc = this.docs.get(id);
        if (!doc) continue;
        const normalizacao = 1 - B + (B * doc.comprimento) / media;
        const peso = (idf * (tf * (K1 + 1))) / (tf + K1 * normalizacao);
        pontuacao.set(id, (pontuacao.get(id) ?? 0) + peso);
      }
    }
    return pontuacao;
  }
}
