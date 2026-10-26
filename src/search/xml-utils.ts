// Small helpers to read XML text with regular expressions (no DOM parser in the plugin runtime).

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decodes &amp; &lt; &gt; &quot; &apos; and numeric references (&#NN; and &#xHH;) in one pass. */
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (todo, corpo: string) => {
    if (corpo[0] === "#") {
      const hex = corpo[1] === "x";
      const codigo = parseInt(hex ? corpo.slice(2) : corpo.slice(1), hex ? 16 : 10);
      return codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo;
    }
    return ENTIDADES[corpo];
  });
}

/**
 * Value of attribute `nome` inside the text of one tag, e.g. atributo('<sheet r:id="rId1"/>', "r:id").
 * Accepts namespace prefixes. The value is returned raw (not decoded).
 */
export function atributo(tag: string, nome: string): string | undefined {
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\s)${escapado}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}
