# AI Vault Search

Fast in-memory hybrid search (graph + BM25 + Markdown sections) over the Obsidian vault and over any folder on the computer, for AI agents, exposed as MCP tools through the AI Ecosystem core: `search`, `find`, `get_section`, `read_table`, `list_folders` and `list_files`. `search_notes` and `find_notes` remain as legacy aliases.

## Universal search

The `pasta` and `arquivo` parameters accept absolute paths anywhere on the computer (for example `C:/Users/you/Documents/project`) or paths relative to the vault.

Supported formats:

- code and text files (for example `.ts`, `.py`, `.txt`)
- Markdown (`.md`)
- spreadsheets and tables: `.csv`, `.tsv` and `.xlsx`
- documents: `.docx` and `.pdf`

When scanning the disk, these folders are skipped: `node_modules`, `dist`, `build`, `.git`, `AppData`, `Windows`, `Program Files` and similar.

Size limits: 5 MB for text files and 50 MB for binary files.

Examples:

```json
{ "termos": ["soma"], "pasta": "C:/Users/you/Documents/project", "extensoes": ["ts", "py"] }
```

```json
{ "query": "Plano de implementação", "pasta": "Projetos" }
```

```json
{ "arquivo": "C:/Users/you/Documents/project/src/a.ts", "secao": "soma" }
```

```json
{ "arquivo": "C:/Users/you/Documents/project/dados.xlsx", "aba": "Planilha1", "linha_inicio": 2, "linha_fim": 20, "formato": "markdown" }
```

## Claude Code hooks and guided setup

The AI Ecosystem core can install Claude Code hooks and a setup skill for this module in the vault's `.claude/` folder:

- skill in `.claude/skills/configurar-ai-vault-search/`, hook entries in `.claude/settings.local.json` (or `settings.json`), state in `.claude/ai-ecosystem/`, and a block in `GEMINI.md` for Antigravity.
- Modules downloaded from the AI Ecosystem module catalog show a confirmation screen listing what will be written before installing. Nothing in your own `.claude/` entries is overwritten.
- Until the guided setup finishes, the module's tools are hidden from Claude Code (other clients still see them).
- Hooks can be set to block, warn or off per module in the AI Ecosystem settings, and they fail open when Obsidian or the plugin is not running.

**Protection hook:** `Grep` or `Glob` inside the vault is redirected to the plugin's search tools. The hook message may name `search_notes`, `list_files` or `get_section`. `search_notes` and `find_notes` are legacy aliases limited to the vault's note engine; the universal `search` and `find` tools also work in any folder on the computer. Folders outside the index and tool-note folders stay allowed.

**Folders outside the index:** a new setting, applied to every search, listing and section read. It is set through the guided setup (key `pastas_fora_do_indice`, a list of vault-relative folders); there is no settings tab for it yet. The plugin also tells the core these folders so the hook leaves them alone.
