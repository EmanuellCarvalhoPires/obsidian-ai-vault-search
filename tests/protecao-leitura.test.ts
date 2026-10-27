import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ContentCache } from "../src/search/content-cache";
import type { Conteudo, ConteudoDeps } from "../src/search/file-content";
import { getSectionUniversal } from "../src/search/universal-read";
import { readTable } from "../src/search/read-table";
import type { UniversalContext } from "../src/search/universal-search";

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
const MARCA = "[REDIGIDO]";
// Fake token, built at runtime so no real-looking secret sits in the source.
const falso = "sk-ant-" + "A".repeat(30);

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
});

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

beforeAll(() => {
  escrever(".env", "TOKEN=abc\n");
  escrever(".claude/.credentials.json", '{"token": "abc"}\n');
  escrever("notas.txt", `chave ${falso}\n`);
  escrever(".env.csv", "a,b\n1,2\n");
  escrever("ok.csv", `id,segredo\n1,${falso}\n`);
  escrever("livre.txt", "texto livre");
});

describe("get_section universal com arquivos protegidos", () => {
  it("recusa o .env pelo caminho absoluto, sem revelar o conteudo", async () => {
    const r = await getSectionUniversal({ arquivo: path.join(pasta, ".env") }, contexto());
    expect(r.total).toBe(0);
    expect(r.resultados).toHaveLength(0);
    expect(r.dicas?.[0]).toMatch(/^Acesso bloqueado/);
  });

  it("recusa o .credentials.json pelo caminho relativo", async () => {
    const r = await getSectionUniversal({ arquivo: ".claude/.credentials.json" }, contexto());
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toMatch(/^Acesso bloqueado/);
  });

  it("redige o token falso no conteudo de um txt comum", async () => {
    const r = await getSectionUniversal({ arquivo: "notas.txt" }, contexto());
    expect(r.total).toBe(1);
    const conteudo = r.resultados[0].conteudo ?? "";
    expect(conteudo).toContain(MARCA);
    expect(conteudo).not.toContain(falso);
  });

  it("le um arquivo comum sem alterar o conteudo", async () => {
    const r = await getSectionUniversal({ arquivo: "livre.txt" }, contexto());
    expect(r.total).toBe(1);
    expect(r.resultados[0].conteudo).toBe("texto livre");
  });
});

describe("read_table com arquivos protegidos", () => {
  it("recusa um csv cujo nome comeca com .env", async () => {
    const r = await readTable({ arquivo: ".env.csv" }, contexto());
    expect(r.total_linhas).toBe(0);
    expect(r.tabela).toBeUndefined();
    expect((r.dicas as string[])[0]).toMatch(/^Acesso bloqueado/);
  });

  it("redige o token falso numa celula da tabela em markdown", async () => {
    const r = await readTable({ arquivo: "ok.csv" }, contexto());
    const tabela = r.tabela as string;
    expect(tabela).toContain(MARCA);
    expect(tabela).not.toContain(falso);
  });

  it("redige o token falso nos registros do formato json", async () => {
    const r = await readTable({ arquivo: "ok.csv", formato: "json" }, contexto());
    const registros = r.tabela as Array<Record<string, unknown>>;
    expect(registros[0].segredo).toBe(MARCA);
    expect(JSON.stringify(registros)).not.toContain(falso);
  });
});
