import { describe, expect, it } from "vitest";
import {
  isUniversalRequest,
  parseExtensions,
  tipoDoArquivo,
} from "../src/search/extensions";
import {
  displayPath,
  resolveScope,
  toAbsolute,
} from "../src/search/path-resolver";

describe("parseExtensions", () => {
  it("junta, normaliza e remove duplicados", () => {
    expect(parseExtensions([".TS", "py"], "js, ts")).toEqual(["ts", "py", "js"]);
  });

  it("'*' vira lista vazia (todas)", () => {
    expect(parseExtensions(undefined, "*")).toEqual([]);
  });
});

describe("tipoDoArquivo", () => {
  it("classifica por tipo", () => {
    expect(tipoDoArquivo("ts")).toBe("codigo");
    expect(tipoDoArquivo("xlsx")).toBe("tabela");
    expect(tipoDoArquivo("pdf")).toBe("documento");
    expect(tipoDoArquivo("md")).toBe("nota");
    expect(tipoDoArquivo("zip")).toBe("outro");
  });
});

describe("isUniversalRequest", () => {
  it("pasta absoluta é universal", () => {
    expect(isUniversalRequest("C:/Users/x", [])).toBe(true);
  });

  it("pasta relativa só com md não é universal", () => {
    expect(isUniversalRequest("Knowledge", ["md"])).toBe(false);
  });

  it("sem pasta e com extensão não-md é universal", () => {
    expect(isUniversalRequest(undefined, ["ts"])).toBe(true);
  });
});

describe("resolveScope", () => {
  it("caminho absoluto Windows com barra final vira fs normalizado", () => {
    expect(resolveScope("C:\\Users\\x\\")).toEqual({ tipo: "fs", abs: "C:/Users/x" });
  });

  it("caminho relativo vira cofre sem barras nas pontas", () => {
    expect(resolveScope("Knowledge\\Sub\\")).toEqual({ tipo: "cofre", rel: "Knowledge/Sub" });
  });

  it("undefined vira a raiz do cofre", () => {
    expect(resolveScope(undefined)).toEqual({ tipo: "cofre", rel: "" });
  });
});

describe("toAbsolute", () => {
  it("cofre junta com o basePath; fs devolve o próprio caminho", () => {
    expect(toAbsolute({ tipo: "cofre", rel: "Notas" }, "C:/Cofre").replace(/\\/g, "/")).toBe(
      "C:/Cofre/Notas",
    );
    expect(toAbsolute({ tipo: "fs", abs: "D:/x" }, "C:/Cofre")).toBe("D:/x");
  });
});

describe("displayPath", () => {
  it("dentro do cofre devolve o caminho relativo", () => {
    expect(displayPath("C:/Cofre/Notas/a.md", "C:/Cofre")).toBe("Notas/a.md");
  });

  it("fora do cofre devolve o caminho absoluto", () => {
    expect(displayPath("D:/x/a.ts", "C:/Cofre")).toBe("D:/x/a.ts");
  });

  it("compara sem diferenciar maiúsculas e minúsculas", () => {
    expect(displayPath("c:/cofre/Notas/a.md", "C:/Cofre")).toBe("Notas/a.md");
  });
});
