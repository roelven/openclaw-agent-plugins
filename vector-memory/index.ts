/**
 * Vector Memory Plugin
 *
 * An OpenClaw plugin that provides vector-based memory with automatic
 * fact extraction and context injection.
 *
 * Features:
 * - Semantic memory search and injection before agent runs
 * - Automatic fact extraction from tool results
 * - Session outcome extraction
 * - Local-first (Ollama + node:sqlite)
 */

import { homedir } from "node:os";
import type {
  VectorMemoryConfig,
  SearchResult,
  ExtractionContext,
  ExtractedFact,
} from "./lib/types.js";
import { VectorMemoryService } from "./lib/service.js";
import { createOllamaEmbeddingProvider } from "./lib/ollama.js";
import { extractFactsFromToolResult, extractFactsFromSessionEnd } from "./lib/extractor.js";

// Session tracking for extraction limits
const sessionStates = new Map<string, { count: number; startTime: number }>();

const DEFAULT_CONFIG: VectorMemoryConfig = {
  database: "~/.openclaw/memory/vectors.db",
  embedding: {
    provider: "ollama",
    model: "nomic-embed-text",
    baseUrl: "http://127.0.0.1:11434",
  },
  autoExtract: {
    enabled: true,
    maxPerSession: 10,
    minImportance: 0.4,
  },
  recall: {
    enabled: true,
    limit: 5,
    minScore: 0.2,
  },
};

function resolvePath(pathStr: string): string {
  return pathStr.replace(/^~/, homedir());
}

function getConfig<T>(
  config: Record<string, unknown> | undefined,
  key: string,
  defaultValue: T,
): T {
  if (!config) return defaultValue;
  const value = config[key];
  return value !== undefined ? (value as T) : defaultValue;
}

function getService(api: any): VectorMemoryService | null {
  try {
    const pluginConfig = api.pluginConfig || {};
    const dbPath = resolvePath(
      getConfig(pluginConfig, "database", DEFAULT_CONFIG.database),
    );
    const embeddingConfig = getConfig(pluginConfig, "embedding", DEFAULT_CONFIG.embedding);
    const autoExtract = getConfig(pluginConfig, "autoExtract", DEFAULT_CONFIG.autoExtract);
    const recall = getConfig(pluginConfig, "recall", DEFAULT_CONFIG.recall);

    const provider = createOllamaEmbeddingProvider({
      baseUrl: resolvePath(embeddingConfig.baseUrl || DEFAULT_CONFIG.embedding.baseUrl),
      model: embeddingConfig.model || DEFAULT_CONFIG.embedding.model,
    });

    const service = new VectorMemoryService(dbPath, provider);
    service.init().catch((err) => {
      api.logger.error?.(`[vector-memory] Failed to init: ${err}`);
    });

    return service;
  } catch (err) {
    api.logger.error?.(`[vector-memory] Failed to create service: ${err}`);
    return null;
  }
}

async function storeFacts(
  api: any,
  service: VectorMemoryService,
  facts: ExtractedFact[],
  source: string,
  context: ExtractionContext,
): Promise<void> {
  if (!facts.length) return;

  const pluginConfig = api.pluginConfig || {};
  const autoExtract = getConfig(pluginConfig, "autoExtract", DEFAULT_CONFIG.autoExtract);
  const minImportance = autoExtract.minImportance ?? DEFAULT_CONFIG.autoExtract.minImportance;

  const sessionKey = context.sessionKey || "default";
  let sessionState = sessionStates.get(sessionKey);
  if (!sessionState) {
    sessionState = { count: 0, startTime: Date.now() };
    sessionStates.set(sessionKey, sessionState);
  }

  const maxPerSession = autoExtract.maxPerSession ?? DEFAULT_CONFIG.autoExtract.maxPerSession;

  for (const fact of facts) {
    if (fact.importance < minImportance) continue;
    if (sessionState.count >= maxPerSession) {
      api.logger.info?.(`[vector-memory] Session extraction limit reached (${maxPerSession})`);
      break;
    }

    try {
      const result = await service.add(fact.content, {
        source,
        category: fact.category,
        importance: fact.importance,
      });
      if (result.isNew) {
        sessionState.count++;
        api.logger.info?.(`[vector-memory] Stored: [${fact.category}] ${fact.content.slice(0, 50)}...`);
      }
    } catch (err) {
      api.logger.error?.(`[vector-memory] Failed to store fact: ${err}`);
    }
  }
}

const plugin = {
  id: "vector-memory",
  name: "Vector Memory",
  kind: "memory" as const,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      database: { type: "string", default: DEFAULT_CONFIG.database },
      embedding: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["ollama"], default: "ollama" },
          model: { type: "string", default: DEFAULT_CONFIG.embedding.model },
          baseUrl: { type: "string", default: DEFAULT_CONFIG.embedding.baseUrl },
        },
      },
      autoExtract: {
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
          maxPerSession: { type: "number", default: 10 },
          minImportance: { type: "number", default: 0.4 },
        },
      },
      recall: {
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
          limit: { type: "number", default: 5 },
          minScore: { type: "number", default: 0.2 },
        },
      },
    },
  },

  register(api: any) {
    api.logger.info?.("[vector-memory] Registering plugin");

    // Register before_agent_start hook for memory injection
    api.on(
      "before_agent_start",
      async (event: any, ctx: any) => {
        const pluginConfig = api.pluginConfig || {};
        const recall = getConfig(pluginConfig, "recall", DEFAULT_CONFIG.recall);
        if (!recall.enabled) return;
        if (!event.prompt) return;

        const service = getService(api);
        if (!service) return;

        try {
          const results = await service.search(event.prompt, {
            limit: recall.limit ?? DEFAULT_CONFIG.recall.limit,
            minScore: recall.minScore ?? DEFAULT_CONFIG.recall.minScore,
          });

          if (results.length === 0) return;

          const memoryContext = results
            .map((r: SearchResult) => `- [${r.memory.category}] ${r.memory.content}`)
            .join("\n");

          api.logger.info?.(`[vector-memory] Injected ${results.length} memories`);

          return {
            prependContext: `<relevant-memories>\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.error?.(`[vector-memory] Search failed: ${err}`);
        }
      },
      { priority: 100 },
    );

    // Register agent_end hook for session outcome extraction
    api.on(
      "agent_end",
      async (event: any, ctx: any) => {
        const pluginConfig = api.pluginConfig || {};
        const autoExtract = getConfig(pluginConfig, "autoExtract", DEFAULT_CONFIG.autoExtract);
        if (!autoExtract.enabled) return;
        if (!event.success) return;

        const service = getService(api);
        if (!service) return;

        try {
          const context: ExtractionContext = {
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            timestamp: Date.now(),
          };

          const facts = extractFactsFromSessionEnd(event.messages, context);
          await storeFacts(api, service, facts, "agent:end", context);

          // Clean up old session states
          const now = Date.now();
          for (const [key, state] of sessionStates.entries()) {
            if (now - state.startTime > 3600000) {
              sessionStates.delete(key);
            }
          }
        } catch (err) {
          api.logger.error?.(`[vector-memory] Session extraction failed: ${err}`);
        }
      },
      { priority: 50 },
    );

    // Register after_tool_call hook for fact extraction
    api.on(
      "after_tool_call",
      async (event: any, ctx: any) => {
        const pluginConfig = api.pluginConfig || {};
        const autoExtract = getConfig(pluginConfig, "autoExtract", DEFAULT_CONFIG.autoExtract);
        if (!autoExtract.enabled) return;
        if (!event.result) return;

        const service = getService(api);
        if (!service) return;

        try {
          const context: ExtractionContext = {
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            toolName: ctx.toolName || event.toolName,
            timestamp: Date.now(),
          };

          const facts = extractFactsFromToolResult(event.toolName, event.result, context);
          await storeFacts(api, service, facts, `tool:${event.toolName}`, context);
        } catch (err) {
          api.logger.error?.(`[vector-memory] Tool extraction failed: ${err}`);
        }
      },
      { priority: 50 },
    );

    api.logger.info("[vector-memory] Plugin registered");
  },
};

export default plugin;
