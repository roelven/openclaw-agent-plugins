# event-stream

An OpenClaw plugin that emits real-time JSON events over a Unix domain socket. Useful for building dashboards, log aggregators, or custom monitoring tools on top of OpenClaw.

## What it does

When enabled, this plugin opens a Unix domain socket and streams one JSON object per line for every significant event in the agent lifecycle:

- **`tool.call`** — Emitted when a tool is about to be called. Includes the tool name and timestamp.
- **`tool.result`** — Emitted after a tool call completes. Includes the tool name, timestamp, and whether an error occurred.
- **`session.end`** — Emitted when an agent session finishes. Includes session ID, session key, duration, message count, and success status.

Events are newline-delimited JSON (NDJSON), making them easy to consume with standard Unix tools, `jq`, or any streaming JSON parser.

The plugin is **disabled by default** and creates zero overhead when disabled — no socket is opened, no hooks fire, no resources are used.

## Why use it

- Build a real-time dashboard showing what your agents are doing
- Pipe events into a log aggregator (Datadog, Loki, ELK) for centralized monitoring
- Debug agent behavior by watching tool calls as they happen
- Measure tool call frequency and error rates
- Zero performance impact when disabled

## Compatibility

- **OpenClaw version**: Requires OpenClaw `main` branch (post-February 2026) with the plugin hook system wired.
- **Hooks used**: `before_tool_call`, `after_tool_call`, `agent_end`, `gateway_stop`. All are part of the standard plugin API.
- **No external dependencies**.

## Installation

```bash
openclaw plugins install @roelven/openclaw-event-stream
```

Then register it in your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["event-stream"],
    "entries": {
      "event-stream": {
        "enabled": true
      }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway stop && openclaw gateway start
```

## Setup

This plugin requires explicit opt-in. After installing, you **must** set `enabled: true` in the plugin config (shown above). Without it, the plugin registers but does nothing.

### Listening to events

Connect to the Unix socket to receive events:

```bash
# Using socat
socat - UNIX-CONNECT:/tmp/openclaw/events.sock

# Using ncat
ncat -U /tmp/openclaw/events.sock
```

Each line is a JSON object:

```json
{"type":"tool.call","timestamp":"2026-02-16T10:30:00.000Z","toolName":"exec"}
{"type":"tool.result","timestamp":"2026-02-16T10:30:01.200Z","toolName":"exec","hasError":false}
{"type":"session.end","timestamp":"2026-02-16T10:31:00.000Z","sessionId":"abc-123","sessionKey":"main","success":true,"durationMs":60000,"messageCount":8}
```

### Custom socket path

By default the socket is created at `/tmp/openclaw/events.sock`. You can change this in the plugin config:

```json
{
  "event-stream": {
    "enabled": true,
    "socketPath": "/var/run/openclaw/events.sock"
  }
}
```

### Example: live tool call monitor

```bash
socat - UNIX-CONNECT:/tmp/openclaw/events.sock | jq -r 'select(.type == "tool.call") | "\(.timestamp) → \(.toolName)"'
```

### Example: pipe to a file for later analysis

```bash
socat - UNIX-CONNECT:/tmp/openclaw/events.sock >> ~/openclaw-events.ndjson &
```

## License

MIT
