# OpenClaw Agent Plugins

A collection of plugins that improve agent reliability, observability, and quality for [OpenClaw](https://github.com/openclaw/openclaw).

## Plugins

### sanitize-tool-results
Prevents session corruption from malformed tool blocks. Uses the `tool_result_persist` hook to:
- Validate tool_use block structure (missing id, name, arguments)
- Truncate oversized results (>100KB)
- Strip ANSI escape codes

### verify-tool-output
Injects verification hints into tool results so the agent verifies its work before claiming success. Uses the `after_tool_call` hook to append `[VERIFY]` prompts after:
- **exec/bash**: Silent success or failure detection
- **write/edit**: Read-back reminder
- **cron**: Schedule verification reminder

**Requires**: The `after_tool_call` hook modification from [openclaw/openclaw PR feat/agent-hardening](https://github.com/openclaw/openclaw) that makes the hook return `appendContent`.

### session-scorer
Scores completed sessions on 4 quality dimensions using the `agent_end` hook:
- **Accuracy** (0-1): Tool calls followed by verification within 2 turns
- **Completeness** (0-1): Final message completion signals
- **Autonomy** (0-1): 1 - (user corrections / user turns)
- **Consistency** (0 or 1): Same tool+params repeated 3+ times = 0

Writes JSON scores to `~/.openclaw/scores/<sessionId>.json`. Includes a CLI (`scores-cli.ts`) for analysis:
```bash
npx tsx scores-cli.ts summary          # 7-day averages
npx tsx scores-cli.ts trend --days 30  # Score trend
npx tsx scores-cli.ts worst --n 5      # Worst sessions
```

### event-stream
Emits JSON events over a Unix domain socket for real-time monitoring. Disabled by default.

Events: `tool.call`, `tool.result`, `session.end`

Listen with: `socat - UNIX-CONNECT:/tmp/openclaw/events.sock`

## Installation

Copy a plugin directory to your OpenClaw extensions folder and register it:

```bash
# Copy plugin
cp -r verify-tool-output ~/.openclaw/extensions/

# Register in ~/.openclaw/openclaw.json:
# plugins.allow: [..., "verify-tool-output"]
# plugins.entries: { "verify-tool-output": { "enabled": true } }

# Restart gateway
openclaw gateway stop && openclaw gateway start
```

## Requirements

- OpenClaw running from `main` (post-Feb 2026) with plugin hooks wired
- The `verify-tool-output` plugin requires the `after_tool_call` hook modification (appendContent support)

## License

MIT
