# AI Vault Search

Fast in-memory hybrid search (graph + BM25 + Markdown sections) over the Obsidian vault for AI agents, exposed as MCP tools through the AI Ecosystem core: `search_notes`, `list_folders`, `list_files` and `get_section`.

## Claude Code hooks and guided setup

The AI Ecosystem core can install Claude Code hooks and a setup skill for this module in the vault's `.claude/` folder:

- skill in `.claude/skills/configurar-ai-vault-search/`, hook entries in `.claude/settings.local.json` (or `settings.json`), state in `.claude/ai-ecosystem/`, and a block in `GEMINI.md` for Antigravity.
- Modules downloaded from the AI Ecosystem module catalog show a confirmation screen listing what will be written before installing. Nothing in your own `.claude/` entries is overwritten.
- Until the guided setup finishes, the module's tools are hidden from Claude Code (other clients still see them).
- Hooks can be set to block, warn or off per module in the AI Ecosystem settings, and they fail open when Obsidian or the plugin is not running.

**Protection hook:** `Grep` or `Glob` inside the vault is redirected to `search_notes`, `list_files` or `get_section`. Folders outside the index and tool-note folders stay allowed.

**Folders outside the index:** a new setting, applied to every search, listing and section read. It is set through the guided setup (key `pastas_fora_do_indice`, a list of vault-relative folders); there is no settings tab for it yet. The plugin also tells the core these folders so the hook leaves them alone.
