import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSearchTools } from "../src/tools/search-tools";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { HubTool } from "../src/ecosystem/types";
import { fakeVault } from "./helpers/fake-vault";

const NOTAS = Array.from({ length: 25 }, (_, i) => ({
  path: `N${String(i + 1).padStart(2, "0")}.md`,
  content: "Texto com alvo.\n",
}));

function ferramentas(): HubTool[] {
  const app = fakeVault(NOTAS);
  return createSearchTools(app, new VaultSearchEngine(app));
}

function ferramenta(nome: string): HubTool {
  const tool = ferramentas().find((t) => t.name === nome);
  if (!tool) throw new Error(`tool ${nome} não encontrada`);
  return tool;
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await ferramenta(nome).handler(args, {} as never);
  const bloco = res.content[0];
  if (bloco.type !== "text") throw new Error(`tool ${nome} não devolveu texto`);
  return JSON.parse(bloco.text) as Record<string, unknown>;
}

describe("search com offset", () => {
  it("offset 20 com limite 10 traz 5 resultados", async () => {
    const json = await chamar("search", { termos: ["alvo"], limite: 10, offset: 20, compacto: false });
    expect((json.resultados as unknown[]).length).toBe(5);
  });

  it("sem offset e com limite 10 traz restantes 15", async () => {
    const json = await chamar("search", { termos: ["alvo"], limite: 10, compacto: false });
    expect(json.restantes).toBe(15);
  });
});

describe("find de notas com offset", () => {
  it("offset 5 com limite 5 traz 5 resultados e restantes", async () => {
    const json = await chamar("find", { query: "N", limite: 5, offset: 5, compacto: false });
    expect((json.resultados as unknown[]).length).toBe(5);
    expect(json.restantes).toBe(15);
  });
});

describe("find universal com offset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-pag-"));

  beforeAll(() => {
    for (let i = 1; i <= 12; i++) {
      fs.writeFileSync(path.join(dir, `arq${String(i).padStart(2, "0")}.txt`), "x");
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("offset 10 com limite 5 traz 2 resultados e sem restantes", async () => {
    const json = await chamar("find", { query: "arq", pasta: dir, extensoes: ["txt"], limite: 5, offset: 10, compacto: false });
    expect((json.resultados as unknown[]).length).toBe(2);
    expect(json.restantes).toBeUndefined();
  });

  it("offset 0 com limite 5 traz restantes 7", async () => {
    const json = await chamar("find", { query: "arq", pasta: dir, extensoes: ["txt"], limite: 5, offset: 0, compacto: false });
    expect(json.restantes).toBe(7);
  });
});

describe("schemas com offset", () => {
  it("search e find declaram offset nas propriedades", () => {
    for (const nome of ["search", "find"]) {
      const props = ferramenta(nome).inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("offset");
    }
  });
});
