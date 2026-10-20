// AI Vault Search — Main Plugin Entry Point
import { Plugin } from "obsidian";
import { EcosystemConnector } from "./ecosystem/connector";
import { AI_ECOSYSTEM_API_VERSION } from "./ecosystem/types";
import type { HubModuleRegistration } from "./ecosystem/types";
import { VaultSearchEngine } from "./search/search-engine";
import { createSearchTools } from "./tools/search-tools";

export const MODULE_ID = "ai-vault-search";

export default class AIVaultSearchPlugin extends Plugin {
  private connector: EcosystemConnector | undefined;
  private engine: VaultSearchEngine | undefined;

  async onload(): Promise<void> {
    console.log("[AI Vault Search] Carregando plugin...");

    this.engine = new VaultSearchEngine(this.app);

    // Conecta ao barramento do AI Ecosystem
    this.connector = new EcosystemConnector(this, {
      buildRegistration: (): HubModuleRegistration => ({
        id: MODULE_ID,
        name: this.manifest.name,
        version: this.manifest.version,
        apiVersion: AI_ECOSYSTEM_API_VERSION,
        tools: createSearchTools(this.app, this.engine!),
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
      onStatus: (status, detail) => {
        console.log(`[AI Vault Search] Status do AI Ecosystem: ${status}`, detail || "");
      },
    });

    this.connector.start();
    console.log("[AI Vault Search] Plugin carregado e registrado no AI Ecosystem.");
  }

  onunload(): void {
    if (this.connector) {
      this.connector.stop();
    }
    console.log("[AI Vault Search] Plugin descarregado.");
  }
}
