// In-memory Obsidian vault for tests and size measurements. Parses a small YAML subset
// (key: value, key: [a, b], "- item" lists), headings, [[links]] and inline #tags.
import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";

export interface FakeNote {
  path: string;
  content: string;
  mtime?: number;
}

interface FakeCache {
  frontmatter?: Record<string, unknown>;
  headings?: { heading: string; level: number; position: { start: { line: number } } }[];
  links?: { link: string }[];
  tags?: { tag: string }[];
}

function parseFrontmatter(content: string): { fm?: Record<string, unknown>; bodyStart: number } {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { bodyStart: 0 };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { bodyStart: 0 };
  const fm: Record<string, unknown> = {};
  let listKey: string | undefined;
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (fm[listKey] as string[]).push(item[1].replace(/^"|"$/g, ""));
      continue;
    }
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].trim();
    if (val === "") {
      fm[key] = [];
      listKey = key;
    } else {
      listKey = undefined;
      if (val.startsWith("[") && val.endsWith("]") && !val.startsWith("[[")) {
        fm[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (val === "true" || val === "false") fm[key] = val === "true";
      else fm[key] = val.replace(/^"|"$/g, "");
    }
  }
  return { fm, bodyStart: end + 1 };
}

function buildCache(content: string): FakeCache {
  const { fm, bodyStart } = parseFrontmatter(content);
  const lines = content.split("\n");
  const headings: NonNullable<FakeCache["headings"]> = [];
  const links: { link: string }[] = [];
  const tags: { tag: string }[] = [];
  lines.forEach((line, i) => {
    if (i < bodyStart) return;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) headings.push({ heading: h[2], level: h[1].length, position: { start: { line: i } } });
    for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) links.push({ link: m[1].split("|")[0] });
  });
  return { frontmatter: fm, headings, links, tags };
}

export function fakeVault(notes: FakeNote[], extraFiles: string[] = []): App {
  const root = new TFolder();
  root.path = "/";
  root.name = "";
  const folders = new Map<string, TFolder>([["", root]]);
  const files: TFile[] = [];
  const contents = new Map<string, string>();
  const caches = new Map<string, FakeCache>();
  const allLoaded: Array<TFile | TFolder> = [root];

  function folderOf(path: string): TFolder {
    if (folders.has(path)) return folders.get(path)!;
    const idx = path.lastIndexOf("/");
    const parent = folderOf(idx < 0 ? "" : path.slice(0, idx));
    const f = new TFolder();
    f.path = path;
    f.name = path.slice(idx + 1);
    parent.children.push(f);
    folders.set(path, f);
    allLoaded.push(f);
    return f;
  }

  function add(path: string, content: string, mtime: number): void {
    const f = new TFile();
    f.path = path;
    f.name = path.split("/").pop() ?? path;
    f.extension = f.name.includes(".") ? (f.name.split(".").pop() ?? "") : "";
    f.basename = f.name.replace(/\.[^.]+$/, "");
    f.stat = { mtime, size: content.length };
    const idx = path.lastIndexOf("/");
    const parent = folderOf(idx < 0 ? "" : path.slice(0, idx));
    f.parent = parent;
    parent.children.push(f);
    files.push(f);
    allLoaded.push(f);
    contents.set(path, content);
    if (f.extension === "md") caches.set(path, buildCache(content));
  }

  notes.forEach((n, i) => add(n.path, n.content, n.mtime ?? 1_700_000_000_000 + i * 60_000));
  extraFiles.forEach((p, i) => add(p, "", 1_700_000_000_000 + i));

  const byPath = new Map<string, TFile | TFolder>();
  for (const f of allLoaded) byPath.set(f.path, f);
  byPath.set("/", root);

  return {
    vault: {
      getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
      getFiles: () => files,
      getAllLoadedFiles: () => allLoaded,
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
      cachedRead: async (f: TFile) => contents.get(f.path) ?? "",
    },
    metadataCache: { getFileCache: (f: TFile) => caches.get(f.path) ?? null },
  } as unknown as App;
}
