import { randomUUID } from "node:crypto";

const MAX_RESULT_BYTES = 100_000;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function sanitizeToolResultContent(content: any[]): { content: any[]; changed: boolean } {
  let changed = false;
  const out = content.map((item: any) => {
    if (item?.type !== "text" || typeof item.text !== "string") return item;
    let text = item.text;

    // Strip ANSI escape codes
    if (ANSI_RE.test(text)) {
      text = text.replace(ANSI_RE, "");
      changed = true;
    }

    // Truncate oversized results (preserve UTF-8 boundary)
    const byteLen = Buffer.byteLength(text);
    if (byteLen > MAX_RESULT_BYTES) {
      const buf = Buffer.from(text);
      text = buf.subarray(0, MAX_RESULT_BYTES).toString("utf-8")
        + `\n\n[TRUNCATED — original ${byteLen} bytes]`;
      changed = true;
    }

    return text !== item.text ? { ...item, text } : item;
  });
  return { content: out, changed };
}

function sanitizeAssistantToolCalls(content: any[], logger: any): { content: any[]; changed: boolean } {
  let changed = false;
  const out = content.map((item: any) => {
    if (item?.type !== "toolCall") return item;
    const fixes: Record<string, any> = {};
    if (!item.id) {
      fixes.id = randomUUID();
      logger.warn(`[sanitize] toolCall missing 'id' (tool: ${item.name ?? "unknown"}). Generated ${fixes.id}`);
    }
    if (!item.name) {
      fixes.name = "__unknown_tool";
      logger.warn(`[sanitize] toolCall missing 'name' (id: ${item.id ?? fixes.id}). Set to __unknown_tool`);
    }
    if (!item.arguments) {
      fixes.arguments = {};
      logger.warn(`[sanitize] toolCall missing 'arguments' (tool: ${item.name ?? fixes.name}, id: ${item.id ?? fixes.id}). Set to {}`);
    }
    if (Object.keys(fixes).length > 0) {
      changed = true;
      return { ...item, ...fixes };
    }
    return item;
  });
  return { content: out, changed };
}

const plugin = {
  id: "sanitize-tool-results",
  name: "Sanitize Tool Results",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: any) {
    api.on("tool_result_persist", (event: any, _ctx: any) => {
      const msg = event.message;
      if (!msg || !Array.isArray(msg.content)) return;

      let changed = false;
      let newContent = msg.content;

      if (msg.role === "toolResult") {
        const result = sanitizeToolResultContent(msg.content);
        if (result.changed) {
          newContent = result.content;
          changed = true;
        }
      }

      if (msg.role === "assistant") {
        const result = sanitizeAssistantToolCalls(msg.content, api.logger);
        if (result.changed) {
          newContent = result.content;
          changed = true;
        }
      }

      if (changed) {
        return { message: { ...msg, content: newContent } };
      }
    }, { priority: 100 });

    api.logger.info("[sanitize-tool-results] Plugin registered");
  },
};

export default plugin;
