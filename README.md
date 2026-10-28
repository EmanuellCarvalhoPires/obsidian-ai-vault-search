# AI Vault Search

Fast in-memory search (note graph + Markdown sections, ranked with BM25 over an index kept up to date by Obsidian events) over the Obsidian vault and over any folder on the computer, for AI agents, exposed as MCP tools through the AI Ecosystem core: `search`, `find`, `get_section`, `get_note`, `read_table`, `list_folders`, `list_files`, `list_tags` and `recent_notes`.

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

## Response format, pagination and safety

- **Compact by default (`compacto: true`):** `search` and `find` return ripgrep-style text (`caminho:linha:trecho`). Empty results show `0 resultados` with hints; `+N` means there is more.
- **JSON when you ask for it:** `compacto: false` returns the lean JSON (path, line, a 120-character snippet and the section). `detalhe: true` returns the long JSON response and `ler: true` also falls back to JSON, since compact text cannot carry those fields.
- **`ler: true`:** the first result also returns the section where the term matched.
- **Pagination:** use `offset` to get the next page; the `restantes` field tells how many results remain.
- **Universal search:** the default limit is 10. When results are cut, `truncado` is set and hints explain how to continue.
- **Matching:** `sinonimos` (off by default) adds synonyms; `exato` matches whole words only.
- **Tree and properties:** `arvore` lists the notes below a root note (following `up:`), limited by `profundidade`. `prop` takes several conditions; a list means all of them must match.
- **Sections:** `get_section` accepts `pedidos` to read up to 10 sections per call.
- **Notes:** `get_note` returns frontmatter, outline, outgoing links and body. `list_tags` lists tags and `recent_notes` lists the latest changed notes.
- **Ranking:** results are ranked with BM25 over an in-memory index that Obsidian events keep up to date.
- **Safety:** files such as `.env*`, `.credentials*`, `*.pem`, SSH keys, `.ssh`, `.aws`, `.npmrc` and `.obsidian/plugins/*/data.json` are never read or listed. Tokens (`sk-ant-`, `ghp_`, `Bearer`) are redacted as `[REDIGIDO]` in the output.

## Claude Code hooks and guided setup

The AI Ecosystem core can install Claude Code hooks and a setup skill for this module in the vault's `.claude/` folder:

- skill in `.claude/skills/configurar-ai-vault-search/`, hook entries in `.claude/settings.local.json` (or `settings.json`), state in `.claude/ai-ecosystem/`, and a block in `GEMINI.md` for Antigravity.
- Modules downloaded from the AI Ecosystem module catalog show a confirmation screen listing what will be written before installing. Nothing in your own `.claude/` entries is overwritten.
- Until the guided setup finishes, the module's tools are hidden from Claude Code (other clients still see them).
- Hooks can be set to block, warn or off per module in the AI Ecosystem settings, and they fail open when Obsidian or the plugin is not running.

**Protection hook:** `Grep` or `Glob` inside the vault is redirected to the plugin's search tools (`search`, `find`, `list_files` or `get_section`). The universal `search` and `find` tools also work in any folder on the computer. Folders outside the index and tool-note folders stay allowed.

**Folders outside the index:** a new setting, applied to every search, listing and section read. It is set through the guided setup (key `pastas_fora_do_indice`, a list of vault-relative folders); there is no settings tab for it yet. The plugin also tells the core these folders so the hook leaves them alone.
