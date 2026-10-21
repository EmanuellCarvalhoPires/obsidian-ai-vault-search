// data.json of the plugin.
import { normalizeFolders } from "./search/exclusion";

export interface VaultSearchSettings {
  /** Vault-relative folders kept out of the search (attachments, archive, tool notes...). */
  pastasForaDoIndice: string[];
}

export const DEFAULT_SETTINGS: VaultSearchSettings = {
  pastasForaDoIndice: [],
};

/** Normalizes whatever is in data.json. Never throws. */
export function loadSettings(raw: unknown): VaultSearchSettings {
  const data = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { pastasForaDoIndice: normalizeFolders(data.pastasForaDoIndice) };
}
