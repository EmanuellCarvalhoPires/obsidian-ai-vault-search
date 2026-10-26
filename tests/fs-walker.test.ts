import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { walkFiles, type ArquivoVarrido } from "../src/search/fs-walker";

let raiz: string;

function criar(rel: string, conteudo = "x"): void {
  const abs = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

async function coletar(
  opts: Parameters<typeof walkFiles>[1],
  pasta = raiz,
): Promise<string[]> {
  const achados: ArquivoVarrido[] = [];
  for await (const arq of walkFiles(pasta, opts)) {
    achados.push(arq);
  }
  // Relative paths with "/" for stable comparisons.
  return achados.map((a) => path.relative(pasta, a.abs).replace(/\\/g, "/")).sort();
}

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
  criar("a.ts");
  criar("b.py");
  criar("sub/c.ts");
  criar("node_modules/d.ts");
  criar(".git/e.ts");
  criar("sub2/deep/f.ts");
});

afterEach(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe("walkFiles", () => {
  it("filtra por extensão, recursivo, ignora node_modules e .git", async () => {
    const achados = await coletar({ extensoes: ["ts"], recursivo: true });
    expect(achados).toEqual(["a.ts", "sub/c.ts", "sub2/deep/f.ts"]);
    expect(achados).not.toContain("node_modules/d.ts");
    expect(achados).not.toContain(".git/e.ts");
  });

  it("extensoes vazio devolve também b.py", async () => {
    const achados = await coletar({ extensoes: [], recursivo: true });
    expect(achados).toContain("b.py");
    expect(achados).toContain("a.ts");
  });

  it("recursivo false só devolve arquivos da raiz", async () => {
    const achados = await coletar({ extensoes: [], recursivo: false });
    expect(achados).toEqual(["a.ts", "b.py"]);
  });

  it("ignorarRel que devolve true para 'sub' esconde c.ts", async () => {
    const achados = await coletar({
      extensoes: ["ts"],
      recursivo: true,
      ignorarRel: (rel) => rel === "sub",
    });
    expect(achados).not.toContain("sub/c.ts");
    expect(achados).toContain("sub2/deep/f.ts");
  });

  it("maxArquivos 1 devolve exatamente 1 arquivo", async () => {
    const achados = await coletar({ extensoes: [], recursivo: true, maxArquivos: 1 });
    expect(achados).toHaveLength(1);
  });

  it("raiz inexistente termina sem lançar e sem resultados", async () => {
    const inexistente = path.join(raiz, "nao-existe");
    const achados = await coletar({ extensoes: [], recursivo: true }, inexistente);
    expect(achados).toEqual([]);
  });

  it("preenche abs com '/', extensao minúscula e tamanho/mtime", async () => {
    criar("Maiusc.TXT", "abc");
    const achados: ArquivoVarrido[] = [];
    for await (const arq of walkFiles(raiz, { extensoes: ["txt"], recursivo: false })) {
      achados.push(arq);
    }
    expect(achados).toHaveLength(1);
    expect(achados[0].nome).toBe("Maiusc.TXT");
    expect(achados[0].extensao).toBe("txt");
    expect(achados[0].tamanho).toBe(3);
    expect(achados[0].abs).not.toContain("\\");
    expect(typeof achados[0].mtime).toBe("number");
  });
});
