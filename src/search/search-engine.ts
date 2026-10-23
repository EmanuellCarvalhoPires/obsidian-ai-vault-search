// Fast memory engine that reads directly from Obsidian's app.metadataCache and vault
import { TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { isExcluded, normalizeFolders } from "./exclusion";
import type { SearchMatch, SearchQueryParams, SearchResultPayload } from "./types";

export const SINONIMOS: Set<string>[] = [
  new Set(["acesso", "access", "credencial", "token", "auth"]),
  new Set(["instancia", "instance", "site", "dominio"]),
  new Set(["ferramenta", "tool", "funcao", "skill"]),
  new Set(["requisicao", "request", "chamada", "endpoint"]),
  new Set(["modelo", "template", "molde", "padrao"]),
  new Set(["empresa", "company", "cliente"]),
  new Set(["projeto", "project", "epico"]),
  new Set(["campo", "field", "customfield"]),
  new Set(["fila", "queue", "jsw", "jsm"]),
  new Set(["deploy", "pipeline", "release", "publicacao"]),
  new Set(["defeito", "bug", "problema", "issue", "falha"]),
  new Set(["automacao", "automation", "fluxo", "workflow"]),
  new Set(["validar", "auditar", "conferir", "checar", "verificar"]),
];

function norm(texto: unknown): string {
  if (!texto) return "";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getVariantes(termo: string): Set<string> {
  const t = norm(termo);
  for (const grupo of SINONIMOS) {
    if (grupo.has(t)) return grupo;
  }
  return new Set([t]);
}

function isIgnored(path: string): boolean {
  return (
    path.startsWith(".obsidian") ||
    path.startsWith(".trash") ||
    path.startsWith(".git") ||
    path.startsWith(".claude") ||
    path.startsWith("scratch")
  );
}

export class VaultSearchEngine {
  private excludedFolders: string[] = [];

  constructor(private readonly app: App) {}

  /** Vault-relative folders left out of every listing, search and section read. */
  setExcludedFolders(folders: string[]): void {
    this.excludedFolders = normalizeFolders(folders);
  }

  getExcludedFolders(): string[] {
    return [...this.excludedFolders];
  }

  private ignored(path: string): boolean {
    return isIgnored(path) || isExcluded(path, this.excludedFolders);
  }

  /** Markdown notes the search can see (same set the "buscar" action reads). */
  getIndexedNotes(): TFile[] {
    return this.getMarkdownFiles();
  }

  private getMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => {
      const p = f.path;
      return (
        !this.ignored(p) &&
        !p.startsWith("MCP/Tools") &&
        !p.startsWith("MCP/Requests")
      );
    });
  }

  private extractUp(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || !frontmatter.up) return [];
    const val = frontmatter.up;
    const items = Array.isArray(val) ? val : [val];
    const upNotes: string[] = [];
    for (const item of items) {
      const matches = String(item).matchAll(/\[\[([^\]|#^]+)/g);
      for (const m of matches) {
        if (m[1]) upNotes.push(m[1].trim());
      }
    }
    return upNotes;
  }

  private extractTags(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = new Set<string>();
    if (cache?.frontmatter?.tags) {
      const fTags = Array.isArray(cache.frontmatter.tags)
        ? cache.frontmatter.tags
        : [cache.frontmatter.tags];
      for (const t of fTags) {
        if (t) tags.add(String(t).replace(/^#/, "").replace(/\/$/, ""));
      }
    }
    if (cache?.tags) {
      for (const t of cache.tags) {
        if (t.tag) tags.add(t.tag.replace(/^#/, "").replace(/\/$/, ""));
      }
    }
    return Array.from(tags);
  }

  private extractOutlinks(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.links) return [];
    return Array.from(new Set(cache.links.map((l) => l.link.replace(/[#^].*$/, "").trim())));
  }

  async search(params: SearchQueryParams): Promise<SearchResultPayload> {
    const startTime = Date.now();
    const acao = params.acao || "buscar";

    // -------------------------------------------------------------
    // AÇÃO 1: Listar Pastas
    // -------------------------------------------------------------
    if (acao === "listar_pastas") {
      const pastaBase = params.pasta || "";
      const recursivo = params.recursivo === true;
      const targetFolder = this.app.vault.getAbstractFileByPath(pastaBase || "/");

      const folders: SearchMatch[] = [];

      const collect = (item: TAbstractFile) => {
        if (this.ignored(item.path)) return;
        if (item instanceof TFolder) {
          let filesCount = 0;
          let subfoldersCount = 0;
          for (const child of item.children) {
            if (this.ignored(child.path)) continue;
            if (child instanceof TFile) filesCount++;
            else if (child instanceof TFolder) subfoldersCount++;
          }
          folders.push({
            tipo: "pasta",
            caminho: item.path,
            nome: item.name || "raiz",
            total_arquivos: filesCount,
            total_subpastas: subfoldersCount,
          });
          if (recursivo) {
            for (const child of item.children) {
              if (child instanceof TFolder) collect(child);
            }
          }
        }
      };

      if (targetFolder instanceof TFolder) {
        if (recursivo) {
          collect(targetFolder);
        } else {
          for (const child of targetFolder.children) {
            if (child instanceof TFolder && !this.ignored(child.path)) {
              let filesCount = 0;
              let subfoldersCount = 0;
              for (const sub of child.children) {
                if (this.ignored(sub.path)) continue;
                if (sub instanceof TFile) filesCount++;
                else if (sub instanceof TFolder) subfoldersCount++;
              }
              folders.push({
                tipo: "pasta",
                caminho: child.path,
                nome: child.name,
                total_arquivos: filesCount,
                total_subpastas: subfoldersCount,
              });
            }
          }
        }
      }

      folders.sort((a, b) => a.caminho.localeCompare(b.caminho));
      return {
        consulta: { acao, pasta: pastaBase || "/", recursivo },
        total: folders.length,
        tempo_ms: Date.now() - startTime,
        resultados: folders,
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 2: Listar Arquivos
    // -------------------------------------------------------------
    if (acao === "listar_arquivos") {
      const pasta = params.pasta || "";
      const ext = (params.extensao || "md").toLowerCase();
      const recursivo = params.recursivo === true;
      const limite = params.limite || 50;

      let allFiles = this.app.vault.getFiles().filter((f) => !this.ignored(f.path));
      if (pasta) {
        const normPasta = pasta.replace(/\/$/, "");
        if (recursivo) {
          allFiles = allFiles.filter((f) => f.path.startsWith(normPasta + "/"));
        } else {
          allFiles = allFiles.filter((f) => f.parent?.path === normPasta);
        }
      }
      if (ext !== "*") {
        allFiles = allFiles.filter((f) => f.extension.toLowerCase() === ext);
      }

      allFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
      const total = allFiles.length;
      const slice = allFiles.slice(0, limite);

      const resultados: SearchMatch[] = slice.map((f) => {
        const cache = this.app.metadataCache.getFileCache(f);
        const tags = cache?.frontmatter?.tags || cache?.tags?.map((t) => t.tag) || [];
        return {
          tipo: "arquivo",
          caminho: f.path,
          nome: f.name,
          extensao: f.extension,
          tamanho_bytes: f.stat.size,
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
          tags: Array.isArray(tags) ? tags : [tags],
        };
      });

      return {
        consulta: { acao, pasta: pasta || "/", extensao: ext, recursivo },
        total,
        tempo_ms: Date.now() - startTime,
        resultados,
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 3: Obter Seção Específica de Nota
    // -------------------------------------------------------------
    if (acao === "obter_secao") {
      const notaAlvo = String(params.nota || "").trim();
      const cabecalhoAlvo = params.cabecalho ? String(params.cabecalho).toLowerCase().trim() : undefined;

      const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, this.excludedFolders));
      const file = files.find(
        (f) => f.path === notaAlvo || f.basename.toLowerCase() === notaAlvo.toLowerCase()
      );

      if (!file) {
        return {
          consulta: { acao, nota: notaAlvo },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: [`Nota não encontrada: ${notaAlvo}`],
        };
      }

      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const lines = content.split("\n");

      // Suporte a intervalo de linhas (linha_inicio / linha_fim)
      if (params.linha_inicio !== undefined || params.linha_fim !== undefined) {
        const start = Math.max(1, params.linha_inicio ?? 1) - 1;
        const end = Math.min(lines.length, params.linha_fim ?? lines.length);
        const sliced = start < end ? lines.slice(start, end) : [];
        return {
          consulta: { acao, nota: file.basename, linha_inicio: start + 1, linha_fim: end },
          total: 1,
          tempo_ms: Date.now() - startTime,
          resultados: [
            {
              tipo: "nota",
              caminho: file.path,
              nome: file.basename,
              linha: start + 1,
              conteudo: sliced.join("\n"),
            },
          ],
        };
      }

      if (!cabecalhoAlvo) {
        const headings = (cache?.headings || []).map((h) => ({
          nivel: h.level,
          titulo: h.heading,
          linha: h.position.start.line + 1,
        }));
        return {
          consulta: { acao, nota: file.basename },
          total: headings.length,
          tempo_ms: Date.now() - startTime,
          resultados: [
            {
              tipo: "nota",
              caminho: file.path,
              nome: file.basename,
              cabecalhos_disponiveis: headings,
            },
          ],
        };
      }

      const headings = cache?.headings || [];
      let startIndex = -1;
      let endIndex = lines.length;
      let foundHeading: string | undefined;

      for (let i = 0; i < headings.length; i++) {
        const h = headings[i];
        if (h.heading.toLowerCase().includes(cabecalhoAlvo)) {
          startIndex = h.position.start.line;
          foundHeading = h.heading;
          for (let j = i + 1; j < headings.length; j++) {
            if (headings[j].level <= h.level) {
              endIndex = headings[j].position.start.line;
              break;
            }
          }
          break;
        }
      }

      if (startIndex === -1) {
        return {
          consulta: { acao, nota: file.basename, cabecalho: cabecalhoAlvo },
          total: 0,
          tempo_ms: Date.now() - startTime,
          resultados: [],
          dicas: [
            `Cabeçalho '${cabecalhoAlvo}' não encontrado. Disponíveis: ${headings.map((h) => h.heading).join(", ")}`,
          ],
        };
      }

      const sectionLines = lines.slice(startIndex, endIndex);
      return {
        consulta: { acao, nota: file.basename, cabecalho: foundHeading },
        total: 1,
        tempo_ms: Date.now() - startTime,
        resultados: [
          {
            tipo: "nota",
            caminho: file.path,
            nome: file.basename,
            secao_titulo: foundHeading,
            secao_linha: startIndex + 1,
            conteudo: sectionLines.join("\n"),
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // AÇÃO 4: Estatísticas / Status do Cofre
    // -------------------------------------------------------------
    if (acao === "status") {
      const mdFiles = this.getMarkdownFiles();
      const allFiles = this.app.vault.getFiles().filter((f) => !this.ignored(f.path));
      const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && !this.ignored(f.path));

      const tagCounts: Record<string, number> = {};
      for (const file of mdFiles) {
        for (const t of this.extractTags(file)) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }

      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([tag, contagem]) => ({ tag, contagem }));

      const recentes: SearchMatch[] = [...mdFiles]
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 5)
        .map((f) => ({
          tipo: "nota",
          nome: f.basename,
          caminho: f.path,
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
        }));

      return {
        consulta: { acao },
        total: mdFiles.length,
        tempo_ms: Date.now() - startTime,
        estatisticas: {
          total_notas: mdFiles.length,
          total_arquivos_geral: allFiles.length,
          total_pastas: folders.length,
          top_tags: topTags,
        },
        resultados: recentes,
      };
    }

    // -------------------------------------------------------------
    // AÇÃO PADRÃO: Busca Híbrida de Notas
    // -------------------------------------------------------------
    const files = this.getMarkdownFiles();
    let candidates = files;

    if (params.nota) {
      const alvo = norm(params.nota);
      const achadas = files.filter((f) => norm(f.basename) === alvo);
      return {
        consulta: { nota: params.nota },
        total: achadas.length,
        tempo_ms: Date.now() - startTime,
        resultados: achadas.map((f) => ({
          tipo: "nota",
          caminho: f.path,
          nome: f.basename,
          tags: this.extractTags(f),
          up: this.extractUp(f),
          modificada: new Date(f.stat.mtime).toLocaleString("pt-BR"),
        })),
      };
    }

    if (params.filhas) {
      const alvo = norm(params.filhas);
      candidates = candidates.filter((f) => {
        const ups = this.extractUp(f);
        return ups.some((u) => norm(u) === alvo);
      });
    }

    if (params.tag) {
      const tagAlvo = norm(params.tag.replace(/^#/, "").replace(/\/$/, ""));
      candidates = candidates.filter((f) => {
        const tags = this.extractTags(f).map((t) => norm(t));
        return tags.some((t) => t === tagAlvo || t.startsWith(tagAlvo + "/"));
      });
    }

    if (params.backlinks) {
      const alvo = norm(params.backlinks);
      candidates = candidates.filter((f) => {
        const links = this.extractOutlinks(f).map((l) => norm(l));
        const ups = this.extractUp(f).map((u) => norm(u));
        return links.includes(alvo) || ups.includes(alvo);
      });
    }

    if (params.prop) {
      const [key, val] = params.prop.split("=");
      const keyNorm = norm(key);
      const valNorm = val ? norm(val) : undefined;

      candidates = candidates.filter((f) => {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm) return false;
        for (const [k, v] of Object.entries(fm)) {
          if (norm(k) === keyNorm) {
            if (!valNorm) return true;
            return norm(String(v)).includes(valNorm);
          }
        }
        return false;
      });
    }

    const termos = (params.termos || []).map((t) => norm(t)).filter(Boolean);
    const results: SearchMatch[] = [];

    for (const file of candidates) {
      const tags = this.extractTags(file);
      const ups = this.extractUp(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter || {};

      let pontos: number | undefined = 0;
      let melhorLinha: number | undefined;
      let melhorTrecho: string | undefined;
      let secaoTitulo: string | undefined;
      let secaoLinha: number | undefined;
      let secaoTrecho: string | undefined;

      if (termos.length > 0) {
        const fileContent = await this.app.vault.cachedRead(file);
        const linhas = fileContent.split("\n");
        const normNome = norm(file.basename);
        const normTags = tags.map((t) => norm(t)).join(" ");
        const normUps = ups.map((u) => norm(u)).join(" ");

        let termosPresentes = 0;

        for (const termo of termos) {
          const variantes = getVariantes(termo);
          let termoPontos = 0;

          const matchVariante = (texto: string) => {
            for (const v of variantes) {
              if (texto.includes(v)) return true;
            }
            return false;
          };

          if (matchVariante(normNome)) termoPontos += 30;
          if (matchVariante(normTags)) termoPontos += 15;
          if (matchVariante(normUps)) termoPontos += 10;

          let ocorrenciasCorpo = 0;
          for (let idx = 0; idx < linhas.length; idx++) {
            const lNorm = norm(linhas[idx]);
            if (matchVariante(lNorm)) {
              ocorrenciasCorpo++;
              if (melhorLinha === undefined) {
                melhorLinha = idx + 1;
                melhorTrecho = linhas[idx].trim().slice(0, 200);
              }
            }
          }

          if (ocorrenciasCorpo > 0) {
            termoPontos += Math.min(ocorrenciasCorpo * 2, 20);
          }

          if (termoPontos > 0) {
            termosPresentes++;
            pontos += termoPontos;
          }
        }

        if (termosPresentes === 0) continue;

        const cobertura = termosPresentes / termos.length;
        pontos = Math.round(pontos * Math.pow(cobertura, 1.3));

        if (params.secao && cache?.headings) {
          for (const h of cache.headings) {
            if (h.position.start.line <= (melhorLinha || 1)) {
              secaoTitulo = h.heading;
              secaoLinha = h.position.start.line + 1;
              const fimLinha = Math.min(h.position.start.line + 8, linhas.length);
              secaoTrecho = linhas.slice(h.position.start.line, fimLinha).join(" ").trim().slice(0, 300);
            }
          }
        }
      } else {
        pontos = undefined;
      }

      results.push({
        tipo: "nota",
        caminho: file.path,
        nome: file.basename,
        tags,
        up: ups,
        modificada: new Date(file.stat.mtime).toLocaleString("pt-BR"),
        pontos,
        linha: melhorLinha,
        trecho: melhorTrecho,
        secao_titulo: secaoTitulo,
        secao_linha: secaoLinha,
        secao_trecho: secaoTrecho,
        skill: frontmatter.skill,
        efeito: frontmatter.efeito,
      });
    }

    results.sort((a, b) => (b.pontos || 0) - (a.pontos || 0) || a.nome.localeCompare(b.nome));

    const total = results.length;
    const limite = params.limite ?? 10;
    const paginados = limite > 0 ? results.slice(0, limite) : results;

    return {
      consulta: {
        acao,
        termos: params.termos,
        tag: params.tag,
        filhas: params.filhas,
        arvore: params.arvore,
        backlinks: params.backlinks,
        prop: params.prop,
      },
      total,
      tempo_ms: Date.now() - startTime,
      resultados: paginados,
    };
  }
}
