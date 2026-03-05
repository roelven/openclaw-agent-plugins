# Vector Memory Plugin

Local vector-based memory with automatic fact extraction and context injection for OpenClaw.

## Features

- **Semantic Search**: Uses Ollama's `nomic-embed-text` model (768 dimensions) for vector embeddings
- **Automatic Extraction**: Extracts facts from tool results and completed sessions
- **Context Injection**: Injects relevant memories into agent context via `before_agent_start` hook
- **Local-first**: Uses `node:sqlite` (built into Node 22+) - no external dependencies
- **Categorization**: Automatically categorizes memories (decision, fix, outcome, config, etc.)

## Requirements

- Node.js 22+ (for `node:sqlite`)
- Ollama running with `nomic-embed-text` model:
  ```bash
  ollama serve
  ollama pull nomic-embed-text
  ```

## Installation

```bash
# Copy plugin to OpenClaw extensions
cp -r vector-memory ~/.openclaw/extensions/

# Add to ~/.openclaw/openclaw.json:
{
  "plugins": {
    "slots": { "memory": "vector-memory" },
    "entries": {
      "vector-memory": {
        "enabled": true,
        "config": {
          "database": "~/.openclaw/memory/vectors.db",
          "embedding": {
            "provider": "ollama",
            "model": "nomic-embed-text",
            "baseUrl": "http://127.0.0.1:11434"
          },
          "recall": { "enabled": true, "limit": 5, "minScore": 0.2 },
          "autoExtract": { "enabled": true, "maxPerSession": 10, "minImportance": 0.4 }
        }
      }
    }
  }
}

# Restart gateway
openclaw gateway stop && openclaw gateway start
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `database` | string | `~/.openclaw/memory/vectors.db` | SQLite database path |
| `embedding.provider` | string | `ollama` | Embedding provider |
| `embedding.model` | string | `nomic-embed-text` | Ollama model |
| `embedding.baseUrl` | string | `http://127.0.0.1:11434` | Ollama API endpoint |
| `recall.enabled` | boolean | `true` | Inject memories into context |
| `recall.limit` | number | `5` | Max memories to inject |
| `recall.minScore` | number | `0.2` | Minimum similarity score |
| `autoExtract.enabled` | boolean | `true` | Extract facts automatically |
| `autoExtract.maxPerSession` | number | `10` | Max facts per session |
| `autoExtract.minImportance` | number | `0.4` | Minimum importance to store |

## Memory Categories

- `decision` - Decisions made (importance: 0.8)
- `correction` - Corrections and updates (importance: 0.7)
- `fix` - Bug fixes and patches (importance: 0.7)
- `outcome` - Completed tasks (importance: 0.6)
- `process` - Workflows and procedures (importance: 0.6)
- `fact` - General facts (importance: 0.5)
- `config` - Configuration values (importance: 0.4)

## Hooks

### `before_agent_start`
Searches for relevant memories based on the user prompt and injects them into the agent context.

### `agent_end`
Extracts outcomes from completed sessions (decisions, fixes, completions).

### `after_tool_call`
Extracts facts from tool results (file paths, config values, etc.).

## Database

The SQLite database is stored at `~/.openclaw/memory/vectors.db` by default:

```
vector_memories          - Memory entries
vector_memory_embeddings - Vector embeddings (768 dims)
vector_memory_fts        - Full-text search index
```

## License

MIT
