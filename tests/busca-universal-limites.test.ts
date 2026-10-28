import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import { excedeLimiteDeTamanho, type Conteudo, type ConteudoDeps } from "../src/search/file-content";
import { walkFiles } from "../src/search/fs-walker";
import type { PdfLoader } from "../src/search/pdf-reader";
import type { HubToolResult } from "../src/ecosystem/types";
import { VaultSearchEngine } from "../src/search/search-engine";
import { searchUniversal, type UniversalContext } from "../src/search/universal-search";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));

function escrever(rel: string, conteudo: string | Uint8Array): void {
  const abs = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

// Fake PDF.js that always fails: these tests never need a real PDF.
const pdfLoader: PdfLoader = async () => {
  throw new Error("pdf indisponivel nos testes");
};

function contexto(): UniversalContext {
  const conteudo: ConteudoDeps = { cache: new ContentCache<Conteudo>(), pdfLoader };
  return { basePath: raiz, excluidas: [], conteudo };
}

beforeAll(() => {
  for (let i = 1; i <= 5; i++) escrever(`corte/sub/t${i}.txt`, `arquivo ${i}\n`);
  for (let i = 1; i <= 3; i++) escrever(`completa/sub/t${i}.txt`, `arquivo ${i}\n`);
  for (let i = 1; i <= 5; i++) escrever(`achados/a${i}.txt`, `linha com alvo ${i}\n`);
  for (let i = 1; i <= 2; i++) escrever(`limexato/a${i}.txt`, `arquivo ${i}\n`);
  fs.mkdirSync(path.join(raiz, "limexato", "vazia"), { recursive: true });
  for (let i = 1; i <= 2; i++) escrever(`limmisto/a${i}.txt`, `arquivo ${i}\n`);
  escrever("limmisto/outro.md", "outro\n");
  escrever("grande/grande.txt", Buffer.alloc(5 * 1024 * 1024 + 1, "a"));
  for (let i = 1; i <= 12; i++) {
    escrever(`doze/arq${String(i).padStart(2, "0")}.txt`, "linha com alvo\n");
  }
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
});

async function colherNomes(pasta: string, opts: Parameters<typeof walkFiles>[1]): Promise<string[]> {
  const nomes: string[] = [];
  for await (const arq of walkFiles(pasta, opts)) nomes.push(arq.nome);
  return nomes;
}

describe("walkFiles aviso de corte", () => {
  it("chama aoCortar uma vez quando ha mais arquivos que maxArquivos", async () => {
    const aoCortar = vi.fn();
    const nomes = await colherNomes(path.join(raiz, "corte"), {
      extensoes: ["txt"],
      recursivo: true,
      maxArquivos: 2,
      aoCortar,
    });
    expect(nomes).toHaveLength(2);
    expect(aoCortar).toHaveBeenCalledTimes(1);
  });

  it("nao chama aoCortar quando ha menos arquivos que o maximo", async () => {
    const aoCortar = vi.fn();
    const nomes = await colherNomes(path.join(raiz, "completa"), {
      extensoes: ["txt"],
      recursivo: true,
      maxArquivos: 100,
      aoCortar,
    });
    expect(nomes).toHaveLength(3);
    expect(aoCortar).not.toHaveBeenCalled();
  });

  it("nao chama aoCortar no limite exato com uma subpasta vazia", async () => {
    const aoCortar = vi.fn();
    const nomes = await colherNomes(path.join(raiz, "limexato"), {
      extensoes: ["txt"],
      recursivo: true,
      maxArquivos: 2,
      aoCortar,
    });
    expect(nomes).toHaveLength(2);
    expect(aoCortar).toHaveBeenCalledTimes(0);
  });

  it("nao chama aoCortar no limite exato quando o arquivo extra tem outra extensao", async () => {
    const aoCortar = vi.fn();
    const nomes = await colherNomes(path.join(raiz, "limmisto"), {
      extensoes: ["txt"],
      recursivo: false,
      maxArquivos: 2,
      aoCortar,
    });
    expect(nomes).toHaveLength(2);
    expect(aoCortar).toHaveBeenCalledTimes(0);
  });
});

describe("excedeLimiteDeTamanho", () => {
  const MB = 1024 * 1024;

  it("usa 5 MB para texto e 50 MB para binarios", () => {
    expect(excedeLimiteDeTamanho("txt", 5 * MB)).toBe(false);
    expect(excedeLimiteDeTamanho("txt", 5 * MB + 1)).toBe(true);
    expect(excedeLimiteDeTamanho("pdf", 6 * MB)).toBe(false);
    expect(excedeLimiteDeTamanho("pdf", 50 * MB + 1)).toBe(true);
  });
});

describe("searchUniversal truncado e dicas", () => {
  const achados = () => path.join(raiz, "achados");
  const buscar = (limite: number, pasta: string = achados()) =>
    searchUniversal({ termos: ["alvo"], extensoes: ["txt"], pasta, recursivo: true, limite }, contexto());

  it("marca truncado e avisa do limite quando ha mais achados", async () => {
    const r = await buscar(3);
    expect(r.total).toBe(3);
    expect(r.resultados).toHaveLength(3);
    expect(r.truncado).toBe(true);
    expect(r.dicas?.some((d) => d.includes("Resultados limitados a 3"))).toBe(true);
  });

  it("nao marca truncado quando os achados cabem exatamente no limite", async () => {
    const r = await buscar(5);
    expect(r.total).toBe(5);
    expect(r.truncado).toBeUndefined();
    expect(r.dicas).toBeUndefined();
  });

  it("nao marca truncado quando o limite sobra", async () => {
    const r = await buscar(10);
    expect(r.total).toBe(5);
    expect(r.truncado).toBeUndefined();
  });

  it("avisa que arquivo acima de 5 MB nao foi lido", async () => {
    const r = await buscar(10, path.join(raiz, "grande"));
    expect(r.total).toBe(0);
    expect(r.dicas?.some((d) => d.includes("acima do limite de tamanho"))).toBe(true);
  });
});

// Reads the JSON answer of a tool; the first content block is text for these tools.
function lerJson(res: HubToolResult): { total: number; truncado?: boolean; resultados: unknown[] } {
  const bloco = res.content[0];
  if (bloco.type !== "text") throw new Error("resposta sem texto");
  return JSON.parse(bloco.text);
}

describe("limite padrao das tools universais", () => {
  const app = fakeVault([]);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const dir = path.join(raiz, "doze");
  const handler = (nome: string) => tools.find((t) => t.name === nome)!.handler;

  it("search sem limite devolve 10 e marca truncado", async () => {
    const res = await handler("search")({ pasta: dir, extensoes: ["txt"], termos: ["alvo"], compacto: false }, {} as never);
    const corpo = lerJson(res);
    expect(corpo.total).toBe(10);
    expect(corpo.truncado).toBe(true);
  });

  it("find sem limite devolve 10 resultados", async () => {
    const res = await handler("find")({ query: "arq", pasta: dir, extensoes: ["txt"], compacto: false }, {} as never);
    const corpo = lerJson(res);
    expect(corpo.resultados).toHaveLength(10);
  });
});
