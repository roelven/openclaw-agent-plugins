# sanitize-tool-results

An OpenClaw plugin that prevents session corruption by cleaning up malformed tool blocks before they get persisted to the conversation history.

## What it does

When an agent session runs, every tool call and its result gets saved to the conversation transcript. Occasionally, tool results arrive malformed — a missing ID, a missing tool name, oversized output from a verbose command, or ANSI color codes from terminal output. If these get persisted as-is, they can confuse the LLM on subsequent turns or break session replay.

This plugin intercepts messages **before they are written to the transcript** and fixes three categories of problems:

1. **Malformed tool call blocks** — If a tool call is missing its `id`, `name`, or `arguments`, the plugin fills in safe defaults (a generated UUID, `__unknown_tool`, or `{}`) and logs a warning.
2. **Oversized results** — Tool output larger than 100 KB is truncated to 100 KB with a `[TRUNCATED]` notice appended. This prevents a single large `cat` or `exec` output from bloating the context window.
3. **ANSI escape codes** — Terminal color codes (`\x1b[32m`, etc.) are stripped so the LLM sees clean text.

The plugin only modifies what gets **persisted** — it does not change what the LLM sees in real time. This makes it safe to run alongside other plugins.

## Why use it

- Prevents rare but hard-to-debug session corruption from malformed tool blocks
- Keeps conversation transcripts clean and replayable
- Avoids context window waste from oversized tool output
- Zero configuration, zero overhead for normal-sized results

## Compatibility

- **OpenClaw version**: Requires OpenClaw `main` branch (post-February 2026) with the plugin hook system wired.
- **Hook used**: `tool_result_persist` — this hook is part of the standard plugin API and does not require any core modifications.
- **No external dependencies**.

## Installation

```bash
openclaw plugins install @roelven/openclaw-sanitize-tool-results
```

Then register it in your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["sanitize-tool-results"],
    "entries": {
      "sanitize-tool-results": { "enabled": true }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway stop && openclaw gateway start
```

## Setup

No additional setup is needed. The plugin works out of the box with sensible defaults:

- Max result size: 100 KB
- ANSI stripping: always on
- Malformed block repair: always on

There is nothing the user or the agent needs to configure after installation.

## License

MIT
