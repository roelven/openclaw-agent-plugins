# verify-tool-output

An OpenClaw plugin that nudges agents to verify their work before claiming success. It appends `[VERIFY]` hints to tool results so the LLM sees a reminder to check what actually happened.

## What it does

Agents have a tendency to run a command, see no error, and immediately tell the user "Done!" — without actually checking that the file was written, the service started, or the cron job was registered. This plugin addresses that by injecting short verification prompts into the tool result that the LLM receives.

After each tool call, the plugin checks which tool was used and appends a context-appropriate hint:

- **exec / bash / process** — If the command failed, the hint tells the agent to read stderr and diagnose before retrying. If the command succeeded but produced no output, it reminds the agent to verify the side effect (check the file exists, the service is running, etc.).
- **write / edit / apply_patch** — The hint tells the agent to read back the file before reporting success.
- **cron** — The hint tells the agent to run `cron.list` to confirm the schedule.

The hints are appended to what the **LLM sees** (not what gets persisted), so they influence behavior without polluting the transcript.

## Why use it

- Reduces "blind success" reports where the agent claims completion without verification
- Catches silent failures (command exits 0 but didn't actually do the thing)
- Encourages read-back after writes, catching truncation or encoding issues early
- Works transparently — the user sees better agent behavior without any prompting on their part

## Compatibility

- **OpenClaw version**: Requires OpenClaw `main` branch (post-February 2026) **with the `after_tool_call` hook modification** from the [feat/agent-hardening branch](https://github.com/openclaw/openclaw). Specifically, this plugin returns `appendContent` from the `after_tool_call` hook, which is not yet part of the standard plugin API.
- **Hook used**: `after_tool_call` with `appendContent` return value.
- **No external dependencies**.

> **Important**: If you install this plugin on a version of OpenClaw that does not have the `appendContent` support in the `after_tool_call` hook, the plugin will register without errors but the verification hints will be silently ignored.

## Installation

```bash
openclaw plugins install @roelven/openclaw-verify-tool-output
```

Then register it in your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["verify-tool-output"],
    "entries": {
      "verify-tool-output": { "enabled": true }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway stop && openclaw gateway start
```

## Setup

No additional configuration is needed. The plugin works immediately after installation.

The verification hints are not configurable — they are intentionally opinionated to keep the plugin simple. If you find the hints too aggressive for your use case, you can disable the plugin per-session or uninstall it.

## License

MIT
