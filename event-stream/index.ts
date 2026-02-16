import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_SOCKET_PATH = "/tmp/openclaw/events.sock";

let server: Server | null = null;
const clients = new Set<Socket>();

function emit(event: { type: string; timestamp: string; [key: string]: unknown }) {
  if (clients.size === 0) return;
  const line = JSON.stringify(event) + "\n";
  for (const client of clients) {
    try {
      client.write(line);
    } catch {
      clients.delete(client);
    }
  }
}

function startServer(socketPath: string, logger: any) {
  if (server) return;

  try {
    mkdirSync(dirname(socketPath), { recursive: true });
  } catch {
    // ignore
  }

  // Clean up stale socket
  try {
    unlinkSync(socketPath);
  } catch {
    // ignore
  }

  server = createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  server.on("error", (err) => {
    logger.warn(`[event-stream] Server error: ${err.message}`);
  });

  server.listen(socketPath, () => {
    logger.info(`[event-stream] Listening on ${socketPath}`);
  });
}

function stopServer() {
  if (!server) return;
  for (const client of clients) {
    try {
      client.destroy();
    } catch {
      // ignore
    }
  }
  clients.clear();
  server.close();
  server = null;
}

const plugin = {
  id: "event-stream",
  name: "Event Stream",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: false },
      socketPath: { type: "string", default: DEFAULT_SOCKET_PATH },
    },
  },
  register(api: any) {
    const config = api.config ?? {};
    const enabled = config.enabled === true;
    const socketPath = config.socketPath || DEFAULT_SOCKET_PATH;

    if (!enabled) {
      api.logger.info("[event-stream] Plugin disabled (set enabled: true to activate)");
      return;
    }

    startServer(socketPath, api.logger);

    // Tool call events
    api.on(
      "after_tool_call",
      async (event: any, _ctx: any) => {
        emit({
          type: "tool.result",
          timestamp: new Date().toISOString(),
          toolName: event?.toolName,
          hasError: Boolean(event?.error),
        });
      },
      { priority: 90 },
    );

    api.on(
      "before_tool_call",
      async (event: any, _ctx: any) => {
        emit({
          type: "tool.call",
          timestamp: new Date().toISOString(),
          toolName: event?.toolName,
        });
      },
      { priority: 90 },
    );

    // Session end with score
    api.on(
      "agent_end",
      async (event: any, ctx: any) => {
        emit({
          type: "session.end",
          timestamp: new Date().toISOString(),
          sessionId: ctx?.sessionId,
          sessionKey: ctx?.sessionKey,
          success: event?.success,
          durationMs: event?.durationMs,
          messageCount: event?.messages?.length ?? 0,
        });
      },
      { priority: 90 },
    );

    // Gateway lifecycle
    api.on(
      "gateway_stop",
      async () => {
        stopServer();
      },
      { priority: 90 },
    );

    api.logger.info(`[event-stream] Plugin registered (socket: ${socketPath})`);
  },
};

export default plugin;
