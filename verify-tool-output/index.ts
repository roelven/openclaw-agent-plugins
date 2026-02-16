const EXEC_TOOLS = new Set(["exec", "bash", "process"]);
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const CRON_TOOLS = new Set(["cron"]);

function getVerificationHint(toolName: string, result: any): string | null {
  if (EXEC_TOOLS.has(toolName)) {
    if (result?.error) {
      return "⚠️ [VERIFY] REQUIRED: Command failed. You MUST read the stderr output and diagnose the root cause. Do NOT retry without explaining the failure first.";
    }
    // Check for empty/no output
    const content = result?.content;
    if (Array.isArray(content)) {
      const text = content
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (!text.trim()) {
        return "⚠️ [VERIFY] REQUIRED: Command produced no output. You MUST verify the effect before reporting success (check the file exists, service is running, or entry was added).";
      }
    }
    return null;
  }

  if (WRITE_TOOLS.has(toolName)) {
    return "⚠️ [VERIFY] REQUIRED: You MUST read back this file before reporting success. Do NOT tell the user the file was created until you have verified its contents with a read tool call.";
  }

  if (CRON_TOOLS.has(toolName)) {
    return "⚠️ [VERIFY] REQUIRED: You MUST run cron.list to verify the job exists and the schedule is correct before reporting success.";
  }

  return null;
}

const plugin = {
  id: "verify-tool-output",
  name: "Verify Tool Output",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: any) {
    // Use after_tool_call to append verification hints to tool results.
    // The modified result is what the LLM sees on the next turn.
    api.on("after_tool_call", async (event: any, _ctx: any) => {
      const hint = getVerificationHint(event.toolName, event.result);
      if (!hint) return;

      return {
        appendContent: [{ type: "text", text: hint }],
      };
    }, { priority: 10 });

    api.logger.info("[verify-tool-output] Plugin registered");
  },
};

export default plugin;
