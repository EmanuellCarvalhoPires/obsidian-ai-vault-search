import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import type { HubTool, HubToolResult } from "../src/ecosystem/types";
import { fakeVault } from "./helpers/fake-vault";

// Real smoke test: runs the tools against the plugin's own source tree (absolute paths).
const raiz = process.cwd();
const pastaSrc = path.join(raiz, "src");
const arquivoAlvo = path.join(raiz, "src", "tools", "search-tools.ts");
const LIMITE_MS = 2000;

function textoDe(res: HubToolResult): string {
  const primeiro = res.content[0];
  return primeiro.type === "text" ? primeiro.text : "";
}

async function executar(tools: HubTool[], nome: string, args: Record<string, unknown>): Promise<HubToolResult> {
  return tools.find((t) => t.name === nome)!.handler(args, {} as never);
}

// Finds the first value stored under `chave` anywhere in a parsed JSON tree.
function acharChave(no: unknown, chave: string): unknown {
  if (no && typeof no === "object") {
    if (chave in no) return (no as Record<string, unknown>)[chave];
    for (const v of Object.values(no)) {
      const achou = acharChave(v, chave);
      if (achou !== undefined) return achou;
    }
  }
  return undefined;
}

// Collects every string value of a parsed JSON tree, so the check does not depend on the exact payload shape.
function valoresTexto(no: unknown, saida: string[] = []): string[] {
  if (typeof no === "string") saida.push(no);
  else if (Array.isArray(no)) no.forEach((n) => valoresTexto(n, saida));
  else if (no && typeof no === "object") Object.values(no).forEach((n) => valoresTexto(n, saida));
  return saida;
}

describe("smoke real: tools against the plugin source tree", () => {
  it("search finds createSearchTools in src/tools/search-tools.ts", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const inicio = performance.now();
    const res = await executar(tools, "search", { termos: ["createSearchTools"], extensoes: ["ts"], pasta: pastaSrc, compacto: false });
    const duracao = performance.now() - inicio;
    const json = JSON.parse(textoDe(res));

    expect(json.resultados.some((r: { caminho: string }) => r.caminho.endsWith("src/tools/search-tools.ts") || r.caminho.endsWith("src\\tools\\search-tools.ts"))).toBe(true);
    expect(duracao).toBeLessThan(LIMITE_MS);
  });

  it("find locates search-tools.ts by name inside src", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const inicio = performance.now();
    const res = await executar(tools, "find", { query: "search-tools", pasta: pastaSrc, compacto: false });
    const duracao = performance.now() - inicio;
    const json = JSON.parse(textoDe(res));

    const caminhos = (json.resultados as Array<{ caminho: string }>).map((r) => r.caminho);
    expect(caminhos.some((c) => c.endsWith("search-tools.ts"))).toBe(true);
    expect(duracao).toBeLessThan(LIMITE_MS);
  });

  it("get_section returns the createSearchTools function from search-tools.ts", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));

    const inicio = performance.now();
    const res = await executar(tools, "get_section", { arquivo: arquivoAlvo, secao: "createSearchTools" });
    const duracao = performance.now() - inicio;
    const json = JSON.parse(textoDe(res));

    const textos = valoresTexto(json);
    expect(textos.some((t) => t.trimStart().startsWith("export function createSearchTools"))).toBe(true);
    // The block spans the whole function (past the multiline signature), not just its first lines.
    const linhaFim = acharChave(json, "linha_fim");
    expect(typeof linhaFim === "number" && linhaFim > 27).toBe(true);
    const conteudo = acharChave(json, "conteudo");
    expect(typeof conteudo === "string" && conteudo.includes("return")).toBe(true);
    expect(duracao).toBeLessThan(LIMITE_MS);
  });
});
