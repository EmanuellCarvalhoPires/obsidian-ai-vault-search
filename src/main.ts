// AI Vault Search — Main Plugin Entry Point
import { Plugin } from "obsidian";
import { EcosystemConnector } from "./ecosystem/connector";
import { AI_ECOSYSTEM_API_VERSION, HOOKS_SERVICE } from "./ecosystem/types";
import type { AIEcosystemAPI, HooksService, HubModuleRegistration, HubTool, ToolIndexEntry } from "./ecosystem/types";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";
import type { VaultSearchSettings } from "./settings";
import { VaultSearchEngine } from "./search/search-engine";
import { createSetupHandler, publishExcludedFolders } from "./setup/setup-handler";
import { createSearchTools } from "./tools/search-tools";

export const MODULE_ID = "ai-vault-search";

export default class AIVaultSearchPlugin extends Plugin {
  private connector: EcosystemConnector | undefined;
  private engine: VaultSearchEngine | undefined;
  private config: VaultSearchSettings = DEFAULT_SETTINGS;
  private api: AIEcosystemAPI | undefined;
  private unregisterSetupHandler: (() => void) | undefined;
  private tools: HubTool[] = [];

  async onload(): Promise<void> {
    this.config = loadSettings(await this.loadData());
    this.engine = new VaultSearchEngine(this.app);
    this.engine.setExcludedFolders(this.config.pastasForaDoIndice);
    this.tools = createSearchTools(this.app, this.engine);

    // Mantém o índice da busca em dia; a sincronização por mtime é a garantia, os eventos só adiantam o trabalho.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.engine?.invalidarNota(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.engine?.removerNota(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, antigo) => this.engine?.renomearNota(antigo, file.path)));
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        this.engine?.aquecerIndice().catch((err: unknown) => console.error("[AI Vault Search] Falha ao aquecer o índice", err));
      }, 3000);
    });

    // Conecta ao barramento do AI Ecosystem
    this.connector = new EcosystemConnector(this, {
      buildRegistration: (): HubModuleRegistration => ({
        id: MODULE_ID,
        name: this.manifest.name,
        version: this.manifest.version,
        apiVersion: AI_ECOSYSTEM_API_VERSION,
        tools: this.tools,
        routes: [
          {
            method: "POST",
            path: "/api/v1/search/notes",
            description: "Busca notas em tempo real no cofre",
            handler: async (req) => {
              const body = (req.body as Record<string, unknown>) || {};
              const res = await this.engine!.search(body);
              return {
                status: 200,
                body: res,
              };
            },
          },
        ],
      }),
      onConnected: (api) => {
        this.api = api;
        this.registerSetupHandler(api);
        this.syncToolIndex(api);
        api.onServiceChange((name) => {
          if (name === HOOKS_SERVICE) this.registerSetupHandler(api);
        });
      },
      onDisconnected: () => {
        this.api = undefined;
        this.unregisterSetupHandler?.();
        this.unregisterSetupHandler = undefined;
      },
      onStatus: () => {
        // Sem log de status.
      },
    });

    this.connector.start();
  }

  onunload(): void {
    this.unregisterSetupHandler?.();
    this.unregisterSetupHandler = undefined;
    if (this.connector) {
      this.connector.stop();
    }
  }

  private registerSetupHandler(api: AIEcosystemAPI): void {
    this.unregisterSetupHandler?.();
    const hooks = api.getService<HooksService>(HOOKS_SERVICE);
    publishExcludedFolders(hooks, MODULE_ID, this.config.pastasForaDoIndice);
    this.unregisterSetupHandler = hooks?.registerSetupHandler(
      MODULE_ID,
      createSetupHandler({
        indexedNotePaths: () => this.engine?.getIndexedNotes().map((f) => f.path) ?? [],
        allFilePaths: () => this.app.vault.getFiles().map((f) => f.path),
        getExcludedFolders: () => this.config.pastasForaDoIndice,
        setExcludedFolders: async (folders) => {
          this.config.pastasForaDoIndice = folders;
          this.engine?.setExcludedFolders(folders);
          await this.saveData(this.config);
          if (this.api) publishExcludedFolders(this.api.getService<HooksService>(HOOKS_SERVICE), MODULE_ID, folders);
        },
      }),
    );
  }

  private syncToolIndex(api: AIEcosystemAPI | undefined = this.api): void {
    if (!api?.toolIndex) return;
    const tools = this.tools;
    const entries: ToolIndexEntry[] = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      categoria: t.categoria,
      tags: t.tags,
      resumo: t.resumo,
      efeito: t.efeito,
      exposicao: t.exposicao,
      aprovacao: t.aprovacao,
      exemplo: t.exemplo,
    }));
    api.toolIndex.sync(MODULE_ID, entries).catch((err: unknown) => {
      console.error("[AI Vault Search] Não foi possível sincronizar o índice de tools", err);
    });
  }
}
