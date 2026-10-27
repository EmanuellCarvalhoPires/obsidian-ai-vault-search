import { describe, expect, it } from "vitest";
import { ehCaminhoBloqueado, MARCA_REDIGIDO, redigirMatch, redigirSegredos } from "../src/search/protecao";
import type { SearchMatch } from "../src/search/types";

// Fake tokens, built at runtime so no real-looking secret sits in the source.
const falso = "sk-ant-" + "A".repeat(30);
const gh = "ghp_" + "B".repeat(30);
const bearer = "Bearer " + "C".repeat(30);

describe("ehCaminhoBloqueado", () => {
  it.each([
    "C:\\Users\\x\\.claude\\.credentials.json",
    "/home/x/.env",
    "proj/.env.local",
    "chaves/servidor.PEM",
    "C:/Users/x/.ssh/id_rsa",
    "C:/Users/x/.ssh/config",
    "C:/Users/x/.aws/credentials",
    "C:/Users/x/.npmrc",
    ".obsidian/plugins/ai-x/data.json",
    "C:/Cofre/.obsidian/plugins/ai-x/data.json",
    "~/id_ed25519.pub",
    "C:/Users/x/.credentials.json",
  ])("bloqueia %s", (caminho) => {
    expect(ehCaminhoBloqueado(caminho)).toBe(true);
  });

  it.each([
    "Projetos/ambiente.md",
    "src/envio.ts",
    "dados/id_clientes.csv",
    ".obsidian/plugins/ai-x/manifest.json",
    "docs/credenciais.md",
    "C:/Users/x/Documents/notas.txt",
  ])("libera %s", (caminho) => {
    expect(ehCaminhoBloqueado(caminho)).toBe(false);
  });

  it("bloqueia pelo caminho do .credentials.json com barras invertidas (BDD)", () => {
    expect(ehCaminhoBloqueado("C:/Users/x/.claude/.credentials.json")).toBe(true);
  });
});

describe("redigirSegredos", () => {
  it("troca o token sk-ant- por [REDIGIDO] e mantem o resto da frase", () => {
    expect(redigirSegredos(`chave ${falso} fim`)).toBe(`chave ${MARCA_REDIGIDO} fim`);
  });

  it("troca o token ghp_ por [REDIGIDO]", () => {
    expect(redigirSegredos(`token ${gh} fim`)).toBe(`token ${MARCA_REDIGIDO} fim`);
  });

  it("troca o Bearer por Bearer [REDIGIDO]", () => {
    expect(redigirSegredos(`auth: ${bearer} ok`)).toBe(`auth: Bearer ${MARCA_REDIGIDO} ok`);
  });

  it("texto sem segredo fica identico", () => {
    const texto = "Reuniao de terca, 10h. Pauta: orcamento e metas.";
    expect(redigirSegredos(texto)).toBe(texto);
  });

  it("aplicar duas vezes da o mesmo resultado", () => {
    const uma = redigirSegredos(`a ${falso} b ${gh} c ${bearer}`);
    expect(redigirSegredos(uma)).toBe(uma);
  });
});

describe("redigirMatch", () => {
  it("devolve copia com trecho e conteudo redigidos e nao altera o original", () => {
    const original: SearchMatch = {
      caminho: "/notas/ok.txt",
      nome: "ok.txt",
      trecho: `alvo ${falso}`,
      conteudo: `linha ${falso}`,
    };
    const copia = redigirMatch(original);
    expect(copia).not.toBe(original);
    expect(copia.trecho).toBe(`alvo ${MARCA_REDIGIDO}`);
    expect(copia.conteudo).toBe(`linha ${MARCA_REDIGIDO}`);
    expect(original.trecho).toBe(`alvo ${falso}`);
    expect(original.conteudo).toBe(`linha ${falso}`);
  });
});
