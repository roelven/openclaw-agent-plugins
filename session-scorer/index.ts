import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SCORES_DIR = join(homedir(), ".openclaw", "scores");
const MIN_TURNS = 3;

// Tools that produce output requiring verification
const VERIFIABLE_TOOLS = new Set([
  "exec", "bash", "process", "write", "edit", "apply_patch", "cron",
]);

// Tools that verify previous output
const VERIFY_TOOLS = new Set(["read", "cat", "head", "exec", "bash"]);

// Correction signals from user
const CORRECTION_PATTERNS = [
  /\bno,?\b/i,
  /\bwrong\b/i,
  /\btry again\b/i,
  /\byou forgot\b/i,
  /\bthat's not\b/i,
  /\bincorrect\b/i,
  /\bnot what I\b/i,
  /\bactually\b/i,
  /\bplease fix\b/i,
];

// Completion signals in final message
const COMPLETION_SIGNALS: [RegExp, number][] = [
  [/\b(done|completed|finished|ready|all set)\b/i, 1.0],
  [/\b(partial|incomplete|couldn't finish|could not finish)\b/i, 0.5],
  [/\b(failed|unable|cannot|can't)\b/i, 0.3],
  [/\b(error|issue|problem)\b/i, 0.4],
];

type Message = {
  role?: string;
  content?: unknown[];
  toolName?: string;
  toolCallId?: string;
};

function extractText(content: unknown[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c: any): c is { type: string; text: string } =>
        c?.type === "text" && typeof c?.text === "string",
    )
    .map((c) => c.text)
    .join("\n");
}

function extractToolCalls(content: unknown[]): { name: string; id?: string }[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (c: any): c is { type: string; name: string; id?: string } =>
        c?.type === "toolCall" && typeof c?.name === "string",
    )
    .map((c) => ({ name: c.name, id: c.id }));
}

function scoreAccuracy(messages: Message[]): number {
  // Accuracy = tool calls with verification (read-back within 2 turns) / total verifiable tool calls
  let verifiableCalls = 0;
  let verifiedCalls = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const toolCalls = extractToolCalls(msg.content);
    const verifiable = toolCalls.filter((tc) => VERIFIABLE_TOOLS.has(tc.name));
    verifiableCalls += verifiable.length;

    if (verifiable.length === 0) continue;

    // Check if any of the next 4 messages (2 assistant turns) contain a verify tool call
    for (let j = i + 1; j < Math.min(i + 5, messages.length); j++) {
      const nextMsg = messages[j];
      if (nextMsg?.role !== "assistant" || !Array.isArray(nextMsg.content)) continue;

      const nextToolCalls = extractToolCalls(nextMsg.content);
      if (nextToolCalls.some((tc) => VERIFY_TOOLS.has(tc.name))) {
        verifiedCalls += verifiable.length;
        break;
      }
    }
  }

  if (verifiableCalls === 0) return 1.0; // No verifiable calls = perfect score
  return Math.round((verifiedCalls / verifiableCalls) * 100) / 100;
}

function scoreCompleteness(messages: Message[]): number {
  // Look at the last assistant message for completion signals
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const text = extractText(msg.content);
    if (!text.trim()) continue;

    for (const [pattern, score] of COMPLETION_SIGNALS) {
      if (pattern.test(text)) return score;
    }
    return 0.8; // Neutral — no clear signal
  }
  return 0.5; // No assistant messages found
}

function scoreAutonomy(messages: Message[]): number {
  // 1 - (user corrections / user turns)
  let userTurns = 0;
  let corrections = 0;

  for (const msg of messages) {
    if (msg?.role !== "user" || !Array.isArray(msg.content)) continue;

    const text = extractText(msg.content);
    if (!text.trim()) continue;

    userTurns++;
    if (CORRECTION_PATTERNS.some((p) => p.test(text))) {
      corrections++;
    }
  }

  if (userTurns === 0) return 1.0;
  return Math.round(Math.max(0, 1 - corrections / userTurns) * 100) / 100;
}

function scoreConsistency(messages: Message[]): number {
  // Same tool+params 3+ times = 0
  const callCounts = new Map<string, number>();

  for (const msg of messages) {
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const item of msg.content as any[]) {
      if (item?.type !== "toolCall") continue;
      const key = `${item.name}:${JSON.stringify(item.arguments ?? {})}`;
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    }
  }

  for (const count of callCounts.values()) {
    if (count >= 3) return 0;
  }
  return 1;
}

const plugin = {
  id: "session-scorer",
  name: "Session Scorer",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: any) {
    api.on(
      "agent_end",
      async (event: any, ctx: any) => {
        const messages: Message[] = event?.messages ?? [];
        const sessionId = ctx?.sessionId;
        const sessionKey = ctx?.sessionKey;

        // Skip short sessions
        if (messages.length < MIN_TURNS || !sessionId) return;

        // Skip cron and subagent sessions for scoring
        if (sessionKey?.includes("subagent:") || sessionKey?.startsWith("cron:")) return;

        const accuracy = scoreAccuracy(messages);
        const completeness = scoreCompleteness(messages);
        const autonomy = scoreAutonomy(messages);
        const consistency = scoreConsistency(messages);

        const score = {
          sessionId,
          sessionKey,
          timestamp: new Date().toISOString(),
          success: event?.success ?? true,
          durationMs: event?.durationMs,
          messageCount: messages.length,
          scores: {
            accuracy,
            completeness,
            autonomy,
            consistency,
          },
          overall:
            Math.round(
              ((accuracy + completeness + autonomy + consistency) / 4) * 100,
            ) / 100,
        };

        try {
          mkdirSync(SCORES_DIR, { recursive: true });
          const filePath = join(SCORES_DIR, `${sessionId}.json`);
          writeFileSync(filePath, JSON.stringify(score, null, 2) + "\n");
          api.logger.info(
            `[session-scorer] Scored session ${sessionId}: overall=${score.overall} ` +
              `(acc=${accuracy} comp=${completeness} auto=${autonomy} cons=${consistency})`,
          );
        } catch (err) {
          api.logger.warn(`[session-scorer] Failed to write score: ${err}`);
        }
      },
      { priority: 50 },
    );

    api.logger.info("[session-scorer] Plugin registered");
  },
};

export default plugin;
