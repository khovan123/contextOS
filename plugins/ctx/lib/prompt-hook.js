import { scheduleContext } from "./scheduler.js";
import { appendJsonLine, writeJsonFile } from "./fs-utils.js";
import { callCtxScoreContext } from "./ctx-mcp-client.js";
import { resolveHookCwd } from "./hook-io.js";
import path from "node:path";

export async function handlePromptPayload(
  payload,
  {
    dataPath,
    historyPath,
    now = new Date(),
    started = Date.now(),
    injectContext = process.env.CONTEXTOS_INJECT !== "0",
    scoreContextClient = callCtxScoreContext,
    mcpDataDir
  } = {}
) {
  const prompt = payload.prompt || payload.message || payload.user_prompt || "";
  const cwd = resolveHookCwd(payload);
  const openFiles = payload.openFiles || payload.open_files || payload.files || [];
  const dataDir = dataPath ? path.dirname(dataPath) : undefined;

  const scored = await scoreContextClient({
    cwd,
    prompt,
    openFiles,
    maxFiles: 3
  }, {
    dataDir: mcpDataDir || dataDir,
    timeoutMs: Number(process.env.CONTEXTOS_MCP_BRIDGE_TIMEOUT_MS || 1000)
  });

  if (scored.error) throw new Error(scored.error);
  const scoredRules = scored.scoredRules || [];
  const relevantFiles = (scored.suggestedFiles || []).slice(0, 3);
  const scheduled = scheduleContext({ rules: scoredRules, relevantFiles });

  const runtime = {
    at: now.toISOString(),
    cwd,
    prompt,
    rules: scoredRules,
    scoring: {
      keyword: true,
      mcp: scored.telemetry || {}
    },
    relevantFiles,
    telemetry: {
      ...(scored.telemetry || {}),
      rulesInjected: (scheduled.highRules?.length || 0) + (scheduled.midRules?.length || 0),
      filesSuggested: relevantFiles.length
    },
    scheduled,
    injected: injectContext,
    elapsedMs: Date.now() - started
  };

  try {
    if (dataPath) writeJsonFile(dataPath, runtime);
    if (historyPath) appendJsonLine(historyPath, runtime);
  } catch {
    // Context injection is the critical path; diagnostics are best-effort.
  }

  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: injectContext ? scheduled.additionalContext : ""
    }
  };
}
