/**
 * Fact Extractor
 *
 * Extracts memorable facts from agent messages and tool results.
 */

import type { ExtractedFact, ExtractionContext, MemoryCategory } from "./types.js";

export function extractFactsFromText(
  text: string,
  context: ExtractionContext,
): ExtractedFact[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const facts: ExtractedFact[] = [];
  const lines = text.split("\n");
  const currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const category = classifyLine(trimmed);
    if (category) {
      if (currentContent.length > 0) {
        const fact = currentContent.join(" ").trim();
        if (fact.length > 10 && fact.length < 500) {
          facts.push(createFact(fact, "fact", context));
        }
        currentContent.length = 0;
      }

      if (trimmed.length > 10 && trimmed.length < 500) {
        facts.push(createFact(trimmed, category, context));
      }
    } else if (trimmed.length > 20) {
      currentContent.push(trimmed);
      if (currentContent.join(" ").length > 300) {
        const fact = currentContent.join(" ").trim();
        facts.push(createFact(fact, "fact", context));
        currentContent.length = 0;
      }
    }
  }

  if (currentContent.length > 0) {
    const fact = currentContent.join(" ").trim();
    if (fact.length > 10 && fact.length < 500) {
      facts.push(createFact(fact, "fact", context));
    }
  }

  return deduplicateFacts(facts);
}

export function extractFactsFromToolResult(
  toolName: string,
  result: unknown,
  context: ExtractionContext,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  if (typeof result === "string") {
    const toolFacts = extractFactsFromText(result, context);
    facts.push(...toolFacts);
  }

  if (result && typeof result === "object") {
    const paths = extractPaths(result);
    for (const path of paths) {
      facts.push(createFact(`File exists: ${path}`, "fact", context));
    }

    const configs = extractConfigs(result);
    for (const config of configs) {
      facts.push(createFact(`Config: ${config}`, "config", context));
    }
  }

  return deduplicateFacts(facts);
}

export function extractFactsFromSessionEnd(
  messages: unknown[],
  context: ExtractionContext,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const recentMessages = messages.slice(-10);

  for (const msg of recentMessages) {
    if (!msg || typeof msg !== "object") continue;

    const role = (msg as { role?: string }).role;
    if (role !== "assistant") continue;

    const content = (msg as { content?: string | unknown[] }).content;
    const text = typeof content === "string" ? content : "";

    if (/(completed|finished|done|success|resolved|fixed)/i.test(text)) {
      const sentences = text.split(/[.!?]/).filter((s) => s.length > 20);
      for (const sentence of sentences) {
        if (/(completed|finished|done|success|resolved|fixed)/i.test(sentence)) {
          facts.push(createFact(sentence.trim(), "outcome", context));
        }
      }
    }

    if (/(decided|will use|going with|chosen)/i.test(text)) {
      const sentences = text.split(/[.!?]/).filter((s) => s.length > 20);
      for (const sentence of sentences) {
        if (/(decided|will use|going with|chosen)/i.test(sentence)) {
          facts.push(createFact(sentence.trim(), "decision", context));
        }
      }
    }
  }

  return deduplicateFacts(facts);
}

function classifyLine(line: string): MemoryCategory | null {
  const lower = line.toLowerCase();

  if (/^(decided|decision|will|going to|chose|chosen)/i.test(line)) return "decision";
  if (/(decided to|will use|going with|chose to)/i.test(line)) return "decision";
  if (/^(fix|fixed|corrected|patched|resolved)/i.test(line)) return "fix";
  if (/(fixed the|corrected the|patched|resolved)/i.test(line)) return "fix";
  if (/^(correction|update|change|changing)/i.test(line)) return "correction";
  if (/^(config|configuration|setting|set to)/i.test(line)) return "config";
  if (/(enabled|disabled)/i.test(line)) return "config";
  if (/^(outcome|completed|finished|done|success)/i.test(line)) return "outcome";
  if (/^(process|workflow|pipeline|steps|procedure)/i.test(line)) return "process";

  return null;
}

function createFact(content: string, category: MemoryCategory, context: ExtractionContext): ExtractedFact {
  return {
    content: sanitizeContent(content),
    category,
    importance: calculateImportance(content, category),
  };
}

function sanitizeContent(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
}

function calculateImportance(content: string, category: MemoryCategory): number {
  const categoryImportance: Record<MemoryCategory, number> = {
    decision: 0.8,
    correction: 0.7,
    fix: 0.7,
    fact: 0.5,
    outcome: 0.6,
    process: 0.6,
    config: 0.4,
  };

  let score = categoryImportance[category] || 0.5;

  if (content.length > 100) score += 0.1;
  if (content.length > 200) score += 0.1;

  const importantKeywords = ["critical", "important", "must", "never", "always", "breaking", "key"];
  const lowerContent = content.toLowerCase();
  for (const kw of importantKeywords) {
    if (lowerContent.includes(kw)) {
      score += 0.1;
      break;
    }
  }

  return Math.min(1, score);
}

function deduplicateFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const seen = new Set<string>();
  const unique: ExtractedFact[] = [];

  for (const fact of facts) {
    const normalized = fact.content.toLowerCase().replace(/\s+/g, " ");
    const key = `${fact.category}:${normalized.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(fact);
    }
  }

  return unique;
}

function extractPaths(obj: unknown): string[] {
  const paths: string[] = [];

  function walk(value: unknown): void {
    if (typeof value === "string") {
      if (/^[\w\-./~]+\.[\w]+$/i.test(value) && value.includes("/")) {
        paths.push(value);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) {
        walk(v);
      }
    }
  }

  walk(obj);
  return paths;
}

function extractConfigs(obj: unknown): string[] {
  const configs: string[] = [];

  function walk(value: unknown, key?: string): void {
    if (key && /(config|setting|option)/i.test(key)) {
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        configs.push(`${key}=${value}`);
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, k);
      }
    }
  }

  walk(obj);
  return configs;
}
