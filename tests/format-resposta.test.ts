import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VaultSearchEngine } from "../src/search/search-engine";
import type { SearchResultPayload } from "../src/search/types";
import { enxugar, formatRipgrep, ripgrepResult } from "../src/tools/format";
import { createSearchTools } from "../src/tools/search-tools";
import type { HubTool, HubToolResult } from "../src/ecosystem/types";
import { fakeVault } from "./helpers/fake-vault";

const notes = [
  { path: "MOC - Tools.md", content: "---\ntags: [moc]\n---\n# MOC\n" },
  { path: "Fluxos/Cat.md", content: '---\ntags: [automacao]\nup: "[[MOC - Tools]]"\n---\n# Cat\n' },
  { path: "Fluxos/Fluxo A.md", content: '---\ntags: [automacao]\nup: "[[Cat]]"\n---\n# A\n## Passos\nacesso ao jira\n' },
];

interface Resposta {
  consulta?: Record<string, unknown>;
  total: number;
  resultados: Array<Record<string, unknown>>;
  [chave: string]: unknown;
}

function textoDe(res: HubToolResult): string {
  const primeiro = res.content[0];
  return primeiro.type === "text" ? primeiro.text : "";
}

function setup() {
  const app = fakeVault(notes, ["Anexos/a.png"]);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const executar = async (nome: string, args: Record<string, unknown>): Promise<HubToolResult> =>
    tools.find((t) => t.name === nome)!.handler(args, {} as never);
  const json = async (nome: string, args: Record<string, unknown>): Promise<Resposta> =>
    JSON.parse(textoDe(await executar(nome, args))) as Resposta;
  return { tools, executar, json };
}

function schemaDe(tool: HubTool): Record<string, Record<string, unknown>> {
  return (tool.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
}

describe("detalhe na tool search", () => {
  it("sem detalhe, o trecho da seção não vem", async () => {
    const { json } = setup();
    const res = await json("search", { termos: ["acesso"], compacto: false });
    expect(res.resultados[0].secao_trecho).toBeUndefined();
  });

  it("com detalhe: true, o trecho da seção traz 'acesso ao jira'", async () => {
    const { json } = setup();
    const res = await json("search", { termos: ["acesso"], detalhe: true });
    expect(res.resultados[0].secao_trecho).toContain("acesso ao jira");
  });

  it("search e find expõem detalhe como boolean no schema", () => {
    const { tools } = setup();
    const search = tools.find((t) => t.name === "search")!;
    const find = tools.find((t) => t.name === "find")!;
    expect(schemaDe(search).detalhe.type).toBe("boolean");
    expect(schemaDe(find).detalhe.type).toBe("boolean");
  });
});

describe("resposta enxuta (enxugar)", () => {
  const payload: SearchResultPayload = {
    consulta: { acao: "buscar", termos: ["alvo"] },
    total: 2,
    tempo_ms: 7,
    resultados: [
      { caminho: "a.md", nome: "a", pontos: 3, modificada: "x", tags: ["t"], up: ["u"], trecho: "oi" },
      { caminho: "b.md", nome: "b", pontos: 2, modificada: "y", tags: [], up: [], trecho: "tchau" },
    ],
  };

  it("sem detalhe tira consulta e as 5 chaves, e mantém trecho, caminho, total e tempo_ms", () => {
    const out = enxugar(payload, false);
    expect(out).not.toHaveProperty("consulta");
    expect(out.total).toBe(2);
    expect(out.tempo_ms).toBe(7);
    const resultados = out.resultados as Array<Record<string, unknown>>;
    expect(Object.keys(resultados[0]).sort()).toEqual(["caminho", "trecho"]);
    expect(resultados[0].trecho).toBe("oi");
    expect(resultados[0].caminho).toBe("a.md");
  });

  it("com detalhe o payload sai igual", () => {
    expect(enxugar(payload, true)).toEqual(payload);
  });

  it("não altera o payload recebido", () => {
    const antes = JSON.stringify(payload);
    enxugar(payload, false, true);
    enxugar(payload, false);
    expect(JSON.stringify(payload)).toBe(antes);
  });

  it("agrupar cria um grupo por arquivo, com trechos sem os campos do arquivo", () => {
    const achados: SearchResultPayload = {
      consulta: { acao: "buscar" },
      total: 3,
      resultados: [
        { tipo: "codigo", caminho: "a.ts", nome: "a", extensao: "ts", modificada: "d1", tamanho_bytes: 10, linha: 1, trecho: "alvo 1" },
        { tipo: "codigo", caminho: "a.ts", nome: "a", extensao: "ts", modificada: "d1", tamanho_bytes: 10, linha: 4, trecho: "alvo 2" },
        { tipo: "texto", caminho: "b.md", nome: "b", extensao: "md", modificada: "d2", linha: 2, trecho: "outro" },
      ],
    };
    const out = enxugar(achados, false, true);
    const grupos = out.resultados as Array<{ caminho: string; tipo: string; trechos: Array<Record<string, unknown>> }>;
    expect(grupos).toHaveLength(2);
    expect(grupos[0].caminho).toBe("a.ts");
    expect(grupos[0].tipo).toBe("codigo");
    expect(grupos[0].trechos).toHaveLength(2);
    expect(grupos[0].trechos[0]).toEqual({ linha: 1, trecho: "alvo 1" });
    expect(out.total).toBe(3);
  });

  it("com detalhe e agrupar nada é agrupado", () => {
    const achados: SearchResultPayload = {
      consulta: { acao: "buscar" },
      total: 1,
      resultados: [{ tipo: "codigo", caminho: "a.ts", nome: "a", linha: 1, trecho: "alvo" }],
    };
    expect(enxugar(achados, true, true)).toEqual(achados);
  });
});

describe("resposta enxuta pela tool", () => {
  it("search sem detalhe não traz consulta, pontos nem nome, e não agrupa", async () => {
    const { json } = setup();
    const res = await json("search", { termos: ["acesso"], compacto: false });
    expect(res).not.toHaveProperty("consulta");
    expect(res.resultados[0].pontos).toBeUndefined();
    expect(res.resultados[0].nome).toBeUndefined();
    expect(res.resultados[0].trechos).toBeUndefined();
    expect(res.resultados[0].caminho).toBe("Fluxos/Fluxo A.md");
  });

  it("search com detalhe: true traz consulta e pontos", async () => {
    const { json } = setup();
    const res = await json("search", { termos: ["acesso"], detalhe: true });
    expect(res.consulta).toBeDefined();
    expect(res.resultados[0].pontos).toBeGreaterThan(0);
  });

  it("find sem detalhe não traz pontos, modificada nem nome", async () => {
    const { json } = setup();
    const res = await json("find", { query: "Fluxo", compacto: false });
    expect(res.resultados[0].pontos).toBeUndefined();
    expect(res.resultados[0].modificada).toBeUndefined();
    expect(res.resultados[0].nome).toBeUndefined();
    expect(res.resultados[0].caminho).toBe("Fluxos/Fluxo A.md");
  });
});

describe("busca universal agrupada pela tool", () => {
  let dir = "";

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "avs-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "const alvo = 1;\nconst outro = alvo + 1;\n");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("um arquivo com 2 achados vira um item com 2 trechos", async () => {
    const app = fakeVault([]);
    const tools = createSearchTools(app, new VaultSearchEngine(app));
    const res = await tools.find((t) => t.name === "search")!.handler(
      { pasta: dir, extensoes: ["ts"], termos: ["alvo"], compacto: false },
      {} as never,
    );
    const json = JSON.parse(textoDe(res)) as Resposta;
    expect(json.resultados).toHaveLength(1);
    const trechos = json.resultados[0].trechos as Array<Record<string, unknown>>;
    expect(trechos).toHaveLength(2);
    expect(json.resultados[0].nome).toBeUndefined();
  });
});

describe("modo compacto", () => {
  it("formatRipgrep sem trecho sai só o caminho, ou caminho e linha", () => {
    expect(formatRipgrep([{ caminho: "a.md" }])).toBe("a.md");
    expect(formatRipgrep([{ caminho: "a.md", linha: 3 }])).toBe("a.md:3");
  });

  it("formatRipgrep troca quebras por espaço no trecho", () => {
    expect(formatRipgrep([{ caminho: "a.md", linha: 3, trecho: "x\r\ny" }])).toBe("a.md:3:x y");
    expect(formatRipgrep([{ caminho: "a.md", trecho: "x" }])).toBe("a.md:1:x");
  });

  it("sem resultados mostra 0 resultados e as dicas", () => {
    const res = ripgrepResult({ resultados: [], total: 0, dicas: ["tente menos termos"] });
    expect(textoDe(res)).toBe("0 resultados\n- tente menos termos");
    expect(res.structuredContent).toBeUndefined();
  });

  it("com mais resultados que os devolvidos, a última linha é +N", () => {
    expect(textoDe(ripgrepResult({ resultados: [{ caminho: "a.md" }], total: 5 }))).toBe("a.md\n+4");
  });

  it("restantes tem prioridade sobre total", () => {
    expect(textoDe(ripgrepResult({ resultados: [{ caminho: "a.md" }], total: 5, restantes: 7 }))).toBe("a.md\n+7");
  });

  it("truncado sem restantes termina com uma linha +", () => {
    expect(textoDe(ripgrepResult({ resultados: [{ caminho: "a.md" }], total: 1, truncado: true }))).toBe("a.md\n+");
  });
});
