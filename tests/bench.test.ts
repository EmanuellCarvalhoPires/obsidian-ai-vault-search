// Response-size measurement (not a regression test). Run: BENCH=1 npx vitest run tests/bench.test.ts
import { it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";
import type { FakeNote } from "./helpers/fake-vault";

export function benchFixture(): FakeNote[] {
  const notes: FakeNote[] = [];
  const body = (i: number) =>
    Array.from(
      { length: 30 },
      (_, l) => `Linha ${l} da nota ${i} sobre acesso, projeto e fluxo com texto de preenchimento razoavelmente longo para simular conteudo real.`,
    ).join("\n");
  notes.push({ path: "MOC - Tools.md", content: "---\ntags: [moc]\n---\n# MOC\n" });
  for (let c = 0; c < 4; c++) {
    notes.push({
      path: `Knowledge/Fluxos/Categoria ${c}.md`,
      content: `---\ntags: [automacao/cat]\nup: "[[MOC - Tools]]"\n---\n# Categoria ${c}\n`,
    });
    for (let i = 0; i < 12; i++) {
      notes.push({
        path: `Knowledge/Fluxos/Fluxo ${c}-${i}.md`,
        content: `---\ntags: [automacao, automacao/tarefas-comuns]\nup: "[[Categoria ${c}]]"\nefeito: leitura\n---\n# Fluxo ${c}-${i}\n## Passos\n${body(i)}\n## Notas\nmais acesso aqui\n`,
      });
    }
  }
  for (let i = 0; i < 40; i++) {
    notes.push({
      path: `Projetos/P${i}/P${i}.md`,
      content: `---\ntags: [dev/projeto]\nup: "[[MOC - Tools]]"\n---\n# P${i}\n## Visao\n${body(i)}\n`,
    });
  }
  for (let i = 0; i < 100; i++) {
    notes.push({ path: `MCP/Tools/Jira/tool${i}.md`, content: `---\ntags: [mcp/tool]\n---\n# tool${i}\nacesso jira\n` });
  }
  for (let i = 0; i < 20; i++) {
    notes.push({ path: `MCP/Requests/Jira/req${i}.md`, content: `---\ntags: [mcp/request]\n---\n# req${i}\nacesso\n` });
  }
  notes.push({ path: ".claude/skills/x/SKILL.md", content: "# Skill\n## Passos\nacesso\n" });
  return notes;
}

const calls: [string, Record<string, unknown>][] = [
  ["search_notes", { termos: ["acesso", "projeto"] }],
  ["search_notes", { tag: "automacao" }],
  ["search_notes", { filhas: "MOC - Tools" }],
  ["search_notes", { backlinks: "MOC - Tools" }],
  ["search_notes", { prop: "efeito=leitura" }],
  ["search_notes", { arvore: "MOC - Tools" }],
  ["list_files", { pasta: "Knowledge/Fluxos", recursivo: true }],
  ["list_folders", { pasta: "", recursivo: true }],
  ["get_section", { nota: "Fluxo 0-0", cabecalho: "Notas" }],
  ["get_section", { nota: "Fluxo 0-0" }],
];

it.skipIf(!process.env.BENCH)("measure", async () => {
  const app = fakeVault(benchFixture());
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const lines: string[] = [];
  for (const [name, args] of calls) {
    const tool = tools.find((t) => t.name === name)!;
    const res = await tool.handler(args, {} as never);
    const bytes = res.content.reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0);
    const structured = res.structuredContent ? JSON.stringify(res.structuredContent).length : 0;
    lines.push(`${name} ${JSON.stringify(args)} => text=${bytes} structured=${structured}`);
  }
  const schemaLen = JSON.stringify(tools.map((t) => ({ n: t.name, d: t.description, s: t.inputSchema }))).length;
  lines.push(`SCHEMA total=${schemaLen} search_notes=${JSON.stringify(tools[0].inputSchema).length + tools[0].description.length}`);
  console.log("BENCH\n" + lines.join("\n"));
});
