// Minimal runtime mock of the "obsidian" package for vitest (aliased in vitest.config.mjs).
export class TFile {
  path = "";
  extension = "md";
  basename = "";
  name = "";
  parent: TFolder | null = null;
  stat = { mtime: 0, size: 0 };
}

export class TFolder {
  path = "";
  name = "";
  children: Array<TFile | TFolder> = [];
}

export async function loadPdfJs(): Promise<never> {
  throw new Error("loadPdfJs não disponível nos testes");
}
