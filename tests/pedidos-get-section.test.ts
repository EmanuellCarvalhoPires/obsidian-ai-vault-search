import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { createSearchTools } from "../src/tools/search-tools";
import { fakeVault } from "./helpers/fake-vault";

describe("get_section com pedidos em lote", () => {
  const app = fakeVault([
    { path: "Guia.md", content: "# Guia\n## Um\ntexto um\n## Dois\ntexto dois\n" },
    { path: "Outra.md", content: "# Outra\n## Tres\ntexto tres\n" },
  ]);
  const tools = createSearchTools(app, new VaultSearchEngine(app));
  const getSection = tools.find((t) => t.name === "get_section")!;
  const chamar = async (args: Record<string, unknown>) => {
    const res = await getSection.handler(args, {} as never);
    return { res, json: JSON.parse((res.content[0] as { text: string }).text) as Record<string, any> };
  };

  it("lê duas seções de notas diferentes numa chamada", async () => {
    const { json } = await chamar({
      pedidos: [
        { arquivo: "Guia", secao: "Um" },
        { arquivo: "Outra", secao: "Tres" },
      ],
    });
    expect(json.total).toBe(2);
    expect(json.resultados[0].conteudo).toContain("texto um");
    expect(json.resultados[1].conteudo).toContain("texto tres");
  });

  it("mantém os válidos e avisa do pedido sem arquivo", async () => {
    const { json } = await chamar({
      pedidos: [
        { arquivo: "Guia", secao: "Um" },
        { secao: "Dois" },
        { arquivo: "Outra", secao: "Tres" },
      ],
    });
    expect(json.total).toBe(2);
    expect(json.dicas).toContain("Pedido 2: informe 'arquivo'");
  });

  it("lê no máximo 10 pedidos e avisa quando recebe mais", async () => {
    const pedidos = Array.from({ length: 12 }, () => ({ arquivo: "Guia", secao: "Um" }));
    const { json } = await chamar({ pedidos });
    expect(json.total).toBe(10);
    expect(json.resultados).toHaveLength(10);
    expect(json.dicas).toContain("Só os 10 primeiros pedidos foram lidos");
  });

  it("chamada antiga com nota e cabecalho continua igual", async () => {
    const { json } = await chamar({ nota: "Guia", cabecalho: "Dois" });
    expect(json.resultados[0].conteudo).toContain("texto dois");
    expect(json.total).toBe(1);
  });
});
