// Answers the guided setup of the AI Ecosystem (tools ecosystem_setup_status/save/complete).
import { largestFolders, normalizeFolders } from "../search/exclusion";
import type { FolderCount } from "../search/exclusion";
import type { HooksService, SetupHandler } from "../ecosystem/types";

export interface SetupHandlerDeps {
  /** Paths of the markdown notes the search currently sees. */
  indexedNotePaths: () => string[];
  /** Paths of every file in the vault (for the folder suggestions). */
  allFilePaths: () => string[];
  getExcludedFolders: () => string[];
  /** Stores the folders and applies them to the search engine. */
  setExcludedFolders: (folders: string[]) => Promise<void>;
}

/** Tells the hooks service which folders are outside the index. No-op in cores without the service. */
export function publishExcludedFolders(hooks: HooksService | undefined, moduleId: string, folders: string[]): void {
  hooks?.setRuleData(moduleId, { excludedFolders: [...folders] });
}

export const LARGEST_FOLDERS_LIMIT = 8;

export function createSetupHandler(deps: SetupHandlerDeps): SetupHandler {
  return {
    async detect() {
      const excludedFolders = deps.getExcludedFolders();
      const largest: FolderCount[] = largestFolders(deps.allFilePaths(), LARGEST_FOLDERS_LIMIT, excludedFolders);
      return {
        noteCount: deps.indexedNotePaths().length,
        largestFolders: largest,
        excludedFolders,
      };
    },

    async save(key, value) {
      if (key === "pastas_fora_do_indice") {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          return "pastas_fora_do_indice must be a list of vault-relative folder paths.";
        }
        const folders = normalizeFolders(value);
        if (folders.some((f) => f.split("/").includes(".."))) return "Folder paths cannot contain '..'.";
        await deps.setExcludedFolders(folders);
        return;
      }
      return `Unknown key: ${key}`;
    },

    async validate() {
      return { ok: true };
    },
  };
}
