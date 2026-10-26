import { describe, expect, it } from "vitest";
import JSZip from "jszip";

describe("jszip smoke", () => {
  it("gera um zip em memória e relê o arquivo", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "olá");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const z = await JSZip.loadAsync(bytes);
    expect(await z.file("a.txt")!.async("string")).toBe("olá");
  });
});
