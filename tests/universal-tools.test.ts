import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchQueryParams } from "../src/search/types";
import { compact } from "../src/tools/format";
import { createSearchTools } from "../src/tools/search-tools";
import type { HubTool, HubToolResult } from "../src/ecosystem/types";
import { fakeVault } from "./helpers/fake-vault";

let dir = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "x.ts"), "export const alvo = 1;\n");
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

describe("universal search, find and legacy aliases", () => {
  it("search with an absolute folder finds the term in src/x.ts", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "search", { pasta: dir, extensoes: ["ts"], termos: ["alvo"] });
    const json = JSON.parse(textoDe(res));

    expect(json.total).toBe(1);
    expect(json.resultados[0].caminho.endsWith("src/x.ts")).toBe(true);
  });

  it("find with an absolute folder returns src/x.ts for the query 'x'", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "find", { query: "x", pasta: dir, extensoes: ["ts"] });
    const json = JSON.parse(textoDe(res));

    const caminhos = (json.resultados as Array<{ caminho: string }>).map((r) => r.caminho);
    expect(caminhos.some((c) => c.endsWith("src/x.ts"))).toBe(true);
  });

  it("search_notes gives the same result as the engine for the legacy parameters on the fake vault", async () => {
    const app = fakeVault([
      { path: "Fluxos/Fluxo A.md", content: "# A\n## Passos\nacesso ao jira\n" },
    ]);
    const engine = new VaultSearchEngine(app);
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "search_notes", { termos: ["acesso"] });
    const json = JSON.parse(textoDe(res));

    const direto: SearchQueryParams = {
      acao: "buscar",
      recursivo: false,
      termos: ["acesso"],
      secao: true,
      limite: 10,
    };
    // Same compaction that jsonResult applies to the engine payload.
    const esperado = JSON.parse(JSON.stringify(compact(await engine.search(direto), true)));
    delete esperado.tempo_ms;
    delete json.tempo_ms;

    expect(json).toEqual(esperado);
    expect(json.total).toBe(1);
    expect(json.resultados[0].caminho).toBe("Fluxos/Fluxo A.md");
  });

  it("search without pasta and without extensoes uses the note engine and does not scan the disk", async () => {
    const app = fakeVault([
      { path: "Notas/Acesso.md", content: "# Acesso\nsenha do portal nao aqui\nacesso liberado\n" },
    ]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const res = await executar(tools, "search", { termos: ["acesso"] });
    const json = JSON.parse(textoDe(res));

    expect(json.total).toBe(1);
    expect(json.resultados[0].caminho).toBe("Notas/Acesso.md");
  });

  it("search_notes reports engine errors with its own name, as the legacy alias did", async () => {
    const app = fakeVault([]);
    const engine = new VaultSearchEngine(app);
    vi.spyOn(engine, "search").mockRejectedValue(new Error("boom"));
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "search_notes", { termos: ["acesso"] });

    expect(res.isError).toBe(true);
    expect(textoDe(res)).toBe("Erro na execução do search_notes: Error: boom");
  });

  it("find_notes reports engine errors with its own name, as the legacy alias did", async () => {
    const app = fakeVault([]);
    const engine = new VaultSearchEngine(app);
    vi.spyOn(engine, "findNotes").mockRejectedValue(new Error("boom"));
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "find_notes", { query: "x" });

    expect(res.isError).toBe(true);
    expect(textoDe(res)).toBe("Erro na execução do find_notes: Error: boom");
  });

  it("search_notes with an absolute folder goes to the note engine, never to the universal search", async () => {
    const app = fakeVault([]);
    const engine = new VaultSearchEngine(app);
    // The universal search would find 'alvo' in src/x.ts (total 1); the engine answer here is total 0.
    const spy = vi
      .spyOn(engine, "search")
      .mockResolvedValue({ total: 0, resultados: [] } as unknown as Awaited<ReturnType<VaultSearchEngine["search"]>>);
    const tools = createSearchTools(app, engine);

    const res = await executar(tools, "search_notes", { pasta: dir, extensoes: ["ts"], termos: ["alvo"] });
    const json = JSON.parse(textoDe(res));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].pasta).toBe(dir);
    expect(json.total).toBe(0);
  });
});
