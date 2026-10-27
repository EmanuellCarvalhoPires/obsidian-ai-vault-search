import { describe, expect, it } from "vitest";
import { VaultSearchEngine } from "../src/search/search-engine";
import { fakeVault } from "./helpers/fake-vault";

function motor() {
  const app = fakeVault([
    { path: "Knowledge/Referência - Notificações no Telegram.md", content: "# Ref\n## Passos\ntexto\n" },
    { path: "A/Duplicada.md", content: "# A\n" },
    { path: "B/Pasta Longa/Duplicada.md", content: "# B\n" },
    { path: "Guia Um.md", content: "# Um\n" },
    { path: "Guia Dois.md", content: "# Dois\n" },
  ]);
  return new VaultSearchEngine(app);
}

describe("obter_secao resolve o nome da nota", () => {
  it("acha a nota pedida com .md no fim", async () => {
    const r = await motor().search({
      acao: "obter_secao",
      nota: "Referência - Notificações no Telegram.md",
    });
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].caminho).toBe("Knowledge/Referência - Notificações no Telegram.md");
  });

  it("acha a nota pelo nome sem acento e em minusculas", async () => {
    const r = await motor().search({
      acao: "obter_secao",
      nota: "referencia - notificacoes no telegram",
    });
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].caminho).toBe("Knowledge/Referência - Notificações no Telegram.md");
  });

  it("acha a nota por correspondencia parcial e avisa", async () => {
    const r = await motor().search({ acao: "obter_secao", nota: "notificacoes" });
    expect(r.resultados).toHaveLength(1);
    expect(r.dicas?.some((d) => d.includes("correspondência parcial"))).toBe(true);
  });

  it("com nomes repetidos escolhe o caminho mais curto e avisa listando as duas", async () => {
    const r = await motor().search({ acao: "obter_secao", nota: "Duplicada" });
    expect(r.total).toBe(1);
    expect(r.resultados[0].caminho).toBe("A/Duplicada.md");
    expect(r.dicas?.[0]).toContain("Havia 2 notas");
    expect(r.dicas?.[0]).toContain("A/Duplicada.md");
    expect(r.dicas?.[0]).toContain("B/Pasta Longa/Duplicada.md");
  });

  it("com dois candidatos parciais nao escolhe nenhum e lista as candidatas", async () => {
    const r = await motor().search({ acao: "obter_secao", nota: "Guia" });
    expect(r.total).toBe(0);
    expect(r.dicas?.[0]).toContain("Nota ambígua");
    expect(r.dicas?.[0]).toContain("Guia Um.md");
    expect(r.dicas?.[0]).toContain("Guia Dois.md");
  });

  it("nome com erro de digitacao sugere a nota parecida", async () => {
    const r = await motor().search({ acao: "obter_secao", nota: "Guia Ums" });
    expect(r.total).toBe(0);
    expect(r.dicas?.some((d) => d.includes("Parecidas:") && d.includes("Guia Um"))).toBe(true);
  });

  it("acha a nota pelo caminho sem .md", async () => {
    const r = await motor().search({
      acao: "obter_secao",
      nota: "Knowledge/Referência - Notificações no Telegram",
    });
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].caminho).toBe("Knowledge/Referência - Notificações no Telegram.md");
  });
});
