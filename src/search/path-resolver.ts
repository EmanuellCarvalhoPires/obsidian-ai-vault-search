import * as path from "node:path";

// Scope of a search or read: a path inside the vault, or an absolute path on the computer.
export type Escopo = { tipo: "cofre"; rel: string } | { tipo: "fs"; abs: string };

// True for Windows drive paths (C:\ or C:/), POSIX paths (/...) and UNC paths (\\...).
export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

// Turns the user's `pasta` argument into a vault-relative or absolute scope.
export function resolveScope(pasta: string | undefined): Escopo {
  const bruto = (pasta ?? "").trim();
  if (bruto === "" || bruto === "." || bruto === "/") {
    return { tipo: "cofre", rel: "" };
  }
  if (isAbsolutePath(bruto)) {
    let abs = bruto.replace(/\\/g, "/");
    while (abs.length > 1 && abs.endsWith("/")) {
      abs = abs.slice(0, -1);
    }
    // Keep the root of a drive as "C:/" instead of "C:".
    if (/^[a-zA-Z]:$/.test(abs)) {
      abs += "/";
    }
    return { tipo: "fs", abs };
  }
  const rel = bruto.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return { tipo: "cofre", rel };
}

// Converts a scope to an absolute path on disk, using the vault base path for vault scopes.
export function toAbsolute(escopo: Escopo, basePath: string): string {
  if (escopo.tipo === "fs") {
    return escopo.abs;
  }
  return path.join(basePath, escopo.rel).replace(/\\/g, "/");
}

// Path relative to the vault (with "/") when abs is strictly inside basePath, otherwise undefined.
// Comparison ignores case because Windows paths are case-insensitive.
export function relativoAoCofre(abs: string, basePath: string): string | undefined {
  if (basePath === "") return undefined;
  const normAbs = abs.replace(/\\/g, "/").replace(/\/+$/, "");
  const normBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normAbs.toLowerCase() === normBase.toLowerCase()) return "";
  if (normAbs.toLowerCase().startsWith(normBase.toLowerCase() + "/")) {
    return normAbs.slice(normBase.length + 1);
  }
  return undefined;
}

// Shows a path relative to the vault when it is inside it, otherwise the full path.
export function displayPath(abs: string, basePath: string): string {
  const normAbs = abs.replace(/\\/g, "/").replace(/\/+$/, "");
  const normBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normAbs.toLowerCase().startsWith(normBase.toLowerCase() + "/")) {
    return normAbs.slice(normBase.length + 1);
  }
  return normAbs;
}
