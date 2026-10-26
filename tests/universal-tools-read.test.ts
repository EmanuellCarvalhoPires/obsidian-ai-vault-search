import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import type { HubTool, HubToolResult } from "../src/ecosystem/types";
import { fakeVault } from "./helpers/fake-vault";

let dir = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src", "a.ts"),
    "export function soma(a: number, b: number): number {\n  return a + b;\n}\n",
  );
  fs.writeFileSync(path.join(dir, "dados.csv"), "nome,valor\nana,1\nbeto,2\n");
  fs.writeFileSync(path.join(dir, "doc.md"), "# Titulo\nTexto do doc\n");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function textoDe(res: HubToolResult): string {
  const primeiro = res.content[0];
  return primeiro.type === "text" ? primeiro.text : "";
}

async function executar(tools: HubTool[], nome: string, args: Record<string, unknown>): Promise<HubToolResult> {
  return tools.find((t) => t.name === nome)!.handler(args, {} as never);
}

describe("universal get_section and read_table", () => {
  it("get_section with an absolute code file and secao 'soma' returns the function body", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "get_section", {
      arquivo: path.join(dir, "src", "a.ts"),
      secao: "soma",
    });

    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("return a + b");
  });

  it("get_section with the legacy nota 'Nota' and cabecalho 'Titulo' keeps reading the vault section", async () => {
    const app = fakeVault([
      { path: "Nota.md", content: "# Titulo\nConteudo da nota\n## Outra\nfim\n" },
    ]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "get_section", { nota: "Nota", cabecalho: "Titulo" });

    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("Conteudo da nota");
  });

  it("get_section with the legacy nota 'Plano v1.2' goes to the note engine, not the universal reader", async () => {
    const app = fakeVault([]);
    const search = vi.fn(async (_req: unknown) => ({ conteudo: "Conteudo do Plano v1.2" }));
    const engine = { search, getExcludedFolders: () => [] } as unknown as VaultSearchEngine;
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "get_section", { nota: "Plano v1.2", cabecalho: "Titulo" });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toMatchObject({ acao: "obter_secao", nota: "Plano v1.2", cabecalho: "Titulo" });
    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("Conteudo do Plano v1.2");
    expect(textoDe(res)).not.toContain("Caminho do cofre indisponível");
  });

  it("get_section with an absolute .ts in arquivo still goes to the universal reader, not the engine", async () => {
    const app = fakeVault([]);
    const search = vi.fn(async () => ({ conteudo: "nao deveria ser usado" }));
    const engine = { search, getExcludedFolders: () => [] } as unknown as VaultSearchEngine;
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "get_section", {
      arquivo: path.join(dir, "src", "a.ts"),
      secao: "soma",
    });

    expect(search).not.toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("return a + b");
  });

  it("get_section with an absolute .ts in nota (legacy alias) goes to the universal reader, not the engine", async () => {
    const app = fakeVault([]);
    const search = vi.fn(async () => ({ conteudo: "nao deveria ser usado" }));
    const engine = { search, getExcludedFolders: () => [] } as unknown as VaultSearchEngine;
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "get_section", {
      nota: path.join(dir, "src", "a.ts"),
      secao: "soma",
    });

    expect(search).not.toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("return a + b");
  });

  it("get_section summary describes the universal reader", () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));
    const tool = tools.find((t) => t.name === "get_section")!;

    expect(tool.resumo).toBe(
      "Lê seção, símbolo, linhas ou páginas de um arquivo do cofre ou do PC (código, md, docx, pdf, txt)",
    );
  });

  it("read_table with the absolute csv returns the markdown table with its header", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "read_table", { arquivo: path.join(dir, "dados.csv") });
    const json = JSON.parse(textoDe(res)) as { tabela: string };

    expect(res.isError).toBeFalsy();
    expect(json.tabela).toContain("nome");
    expect(json.tabela).toContain("valor");
    expect(json.tabela).toContain("ana");
  });

  it("get_section with an absolute markdown file reads the section by the universal path", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "get_section", {
      arquivo: path.join(dir, "doc.md"),
      secao: "Titulo",
    });

    expect(res.isError).toBeFalsy();
    expect(textoDe(res)).toContain("Texto do doc");
  });

  it("get_section without arquivo or nota returns isError true", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "get_section", {});

    expect(res.isError).toBe(true);
  });
});
