// Folders the user keeps out of the search (attachments, archive, tool notes...).
// Paths are vault-relative with "/" and compared as whole folder segments.

/** Cleans a user-provided list: trims, unifies separators, drops empties, "." and duplicates. */
export function normalizeFolders(folders: unknown): string[] {
  if (!Array.isArray(folders)) return [];
  const out = new Set<string>();
  for (const raw of folders) {
    if (typeof raw !== "string") continue;
    const folder = raw
      .trim()
      .replace(/[\\]/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/^\.?\/+/, "")
      .replace(/\/+$/, "");
    if (folder !== "" && folder !== ".") out.add(folder);
  }
  return [...out];
}

/** Lowercase with "/" separators: the disk ignores case on Windows, so the comparison does too. */
function foldKey(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

/** True when the path is one of the folders or inside one of them (case-insensitive). */
export function isExcluded(path: string, folders: readonly string[]): boolean {
  const key = foldKey(path);
  for (const folder of folders) {
    const f = foldKey(folder);
    if (key === f || key.startsWith(`${f}/`)) return true;
  }
  return false;
}

export interface FolderCount {
  pasta: string;
  arquivos: number;
}

/**
 * The folders holding the most files, as candidates to leave out of the index. Counts are
 * recursive; looks at the first two levels and skips a subfolder that holds everything its
 * parent holds (it would only repeat the suggestion).
 */
export function largestFolders(paths: readonly string[], limit: number, skip: readonly string[] = []): FolderCount[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/");
    parts.pop();
    for (let depth = 1; depth <= Math.min(2, parts.length); depth++) {
      const folder = parts.slice(0, depth).join("/");
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  const list: FolderCount[] = [];
  for (const [pasta, arquivos] of counts) {
    if (isExcluded(pasta, skip)) continue;
    const slash = pasta.lastIndexOf("/");
    if (slash > 0 && counts.get(pasta.slice(0, slash)) === arquivos) continue;
    list.push({ pasta, arquivos });
  }
  list.sort((a, b) => b.arquivos - a.arquivos || a.pasta.localeCompare(b.pasta));
  return list.slice(0, limit);
}
