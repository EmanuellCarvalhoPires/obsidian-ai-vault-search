import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import { findUniversal } from "../src/search/universal-find";
import { searchUniversal, type UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
const MARCA = "[REDIGIDO]";
// Fake token, built at runtime so no real-looking secret sits in the source.
const falso = "sk-ant-" + "A".repeat(30);

function escrever(rel: string, conteudo: string): void {
  const abs = path.join(pasta, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
}

function contexto(): UniversalContext {
  const conteudo: ConteudoDeps = {
    cache: new ContentCache<Conteudo>(),
    pdfLoader: async () => {
      throw new Error("pdf nao usado neste teste");
    },
  };
  return { basePath: pasta, excluidas: [], conteudo };
}

function buscarConteudo(termos: string[], extensoes: string[]) {
  return searchUniversal({ termos, extensoes, pasta, recursivo: true, limite: 20 }, contexto());
}

function buscarNome(query: string) {
  return findUniversal({ query, extensoes: [], pasta, limite: 20 }, { basePath: pasta, excluidas: [] });
}

beforeAll(() => {
  escrever(".env.txt", "alvo secreto\n");
  escrever(".credentials.json", '{"alvo": "x"}\n');
  escrever("ok.txt", `alvo comum\nalvo ${falso}\n`);
  escrever("servidor.pem", "alvo\n");
  escrever(".env", "alvo\n");
});

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

describe("searchUniversal com arquivos protegidos", () => {
  it("so devolve resultados de ok.txt; .env.txt e .credentials.json ficam fora", async () => {
    const r = await buscarConteudo(["alvo"], ["txt", "json"]);
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.every((x) => x.nome === "ok.txt")).toBe(true);
    expect(r.resultados.some((x) => x.caminho.endsWith(".env.txt"))).toBe(false);
    expect(r.resultados.some((x) => x.caminho.endsWith(".credentials.json"))).toBe(false);
  });

  it("nenhum trecho traz o token e algum trecho traz [REDIGIDO]", async () => {
    const r = await buscarConteudo(["alvo"], ["txt", "json"]);
    const trechos = r.resultados.map((x) => x.trecho ?? "");
    expect(trechos.some((t) => t.includes(falso))).toBe(false);
    expect(trechos.some((t) => t.includes(MARCA))).toBe(true);
  });
});

describe("findUniversal com arquivos protegidos", () => {
  it("consulta env nao lista .env nem .env.txt", async () => {
    const r = await buscarNome("env");
    const nomes = r.resultados.map((x) => x.nome);
    expect(nomes).not.toContain(".env");
    expect(nomes).not.toContain(".env.txt");
  });

  it("consulta servidor nao lista servidor.pem", async () => {
    const r = await buscarNome("servidor");
    expect(r.resultados.map((x) => x.nome)).not.toContain("servidor.pem");
  });

  it("consulta ok lista ok.txt", async () => {
    const r = await buscarNome("ok");
    expect(r.resultados.map((x) => x.nome)).toContain("ok.txt");
  });
});
