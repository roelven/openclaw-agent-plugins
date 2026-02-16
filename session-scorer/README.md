# session-scorer

An OpenClaw plugin that automatically scores every agent session on four quality dimensions — accuracy, completeness, autonomy, and consistency. Scores are written to disk as JSON for trend analysis over time.

## What it does

When an agent session ends, this plugin analyzes the full conversation transcript and produces a score from 0 to 1 on four dimensions:

- **Accuracy** — Did the agent verify its work? Measures the ratio of "verifiable" tool calls (exec, write, edit, etc.) that were followed by a verification step (read, exec) within 2 turns. An agent that writes a file and then reads it back scores higher than one that writes and moves on.
- **Completeness** — Did the agent finish the task? Looks at the final assistant message for completion signals like "done", "ready", "all set" (score: 1.0), or failure signals like "unable", "failed" (score: 0.3).
- **Autonomy** — Did the agent work independently? Calculated as `1 - (user corrections / user turns)`. If the user had to say "no", "wrong", "try again", or "you forgot" frequently, the autonomy score drops.
- **Consistency** — Did the agent avoid repetitive loops? If the same tool call with identical parameters appears 3 or more times, the consistency score drops to 0. This catches retry loops where the agent keeps doing the same failing thing.

An **overall** score is the simple average of all four dimensions.

Scores are written as individual JSON files to `~/.openclaw/scores/<sessionId>.json`. Sessions shorter than 3 turns, cron sessions, and subagent sessions are skipped.

## Why use it

- Track agent quality over time — are things getting better or worse?
- Identify problematic sessions that need human review
- Measure the impact of prompt changes, model upgrades, or new plugins
- The scores are lightweight heuristics, not LLM-based — zero additional API cost

## Compatibility

- **OpenClaw version**: Requires OpenClaw `main` branch (post-February 2026) with the plugin hook system wired.
- **Hook used**: `agent_end` — this hook is part of the standard plugin API and does not require any core modifications.
- **No external dependencies**.

## Installation

```bash
openclaw plugins install @roelven/openclaw-session-scorer
```

Then register it in your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["session-scorer"],
    "entries": {
      "session-scorer": { "enabled": true }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway stop && openclaw gateway start
```

## Setup

No additional configuration is needed. The plugin starts scoring sessions immediately.

Scores are written to `~/.openclaw/scores/`. This directory is created automatically on first use.

### Using the CLI

The plugin ships with a CLI tool for analyzing scores:

```bash
# Show 7-day averages
npx openclaw-scores summary

# Show score trend over the last 30 days
npx openclaw-scores trend --days 30

# Show the 5 worst sessions
npx openclaw-scores worst --n 5
```

All commands support `--json` for machine-readable output:

```bash
npx openclaw-scores summary --json
```

Example output:

```
Session Quality Summary (last 7 days)
────────────────────────────────────────
Sessions scored: 12
Overall:         0.83
  Accuracy:      0.75
  Completeness:  0.92
  Autonomy:      0.88
  Consistency:   0.78
Success rate:    92%
```

## License

MIT
