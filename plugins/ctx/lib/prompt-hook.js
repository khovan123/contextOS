import { scheduleContext } from "./scheduler.js";
import { appendJsonLine, writeJsonFile } from "./fs-utils.js";
import { maybeAutoWarmWorkspace } from "./auto-warm.js";
import { callCtxScoreContext } from "./ctx-mcp-client.js";
import { resolveHookCwd } from "./hook-io.js";
import { loadOutputConfig } from "./output-config.js";
import { scoreContext as scoreContextDirect } from "./score-context.js";
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
    scoreContextDirectClient = scoreContextDirect,
    autoWarmWorkspace = maybeAutoWarmWorkspace,
    mcpDataDir,
    outputConfig,
    directFallbackTimeoutMs = Number(process.env.CONTEXTOS_DIRECT_FALLBACK_TIMEOUT_MS || 6000)
  } = {}
) {
  const prompt = payload.prompt || payload.message || payload.user_prompt || "";
  const cwd = resolveHookCwd(payload);
  const openFiles = payload.openFiles || payload.open_files || payload.files || [];
  const dataDir = dataPath ? path.dirname(dataPath) : undefined;

  let scored;
  try {
    scored = await scoreContextClient({
      cwd,
      prompt,
      openFiles,
      maxFiles: 3
    }, {
      dataDir: mcpDataDir || dataDir,
      timeoutMs: Number(process.env.CONTEXTOS_MCP_BRIDGE_TIMEOUT_MS || 2000)
    });
  } catch (error) {
    try {
      scored = await withTimeout(scoreContextDirectClient({
        cwd,
        prompt,
        openFiles,
        maxFiles: 3,
        dataDir: mcpDataDir || dataDir,
        embeddingTimeoutMs: Number(process.env.CONTEXTOS_HOOK_EMBEDDING_TIMEOUT_MS || 500),
        fileEmbeddingTimeoutMs: Number(process.env.CONTEXTOS_HOOK_FILE_EMBEDDING_TIMEOUT_MS || 500)
      }), directFallbackTimeoutMs, "direct fallback scoring");
      scored.telemetry = {
        ...(scored.telemetry || {}),
        bridgeStatus: "fallback",
        bridgeError: error?.message || String(error)
      };
    } catch (directError) {
      scored = emptyScore({
        bridgeStatus: "fallback-failed",
        bridgeError: error?.message || String(error),
        directFallbackError: directError?.message || String(directError)
      });
    }
  }

  if (scored.error) throw new Error(scored.error);
  const scoredRules = scored.scoredRules || [];
  const relevantFiles = (scored.suggestedFiles || []).slice(0, 3);
  const suggestedSkills = (scored.suggestedSkills || []).slice(0, 3);
  const suggestedWorkflows = (scored.suggestedWorkflows || []).slice(0, 2);
  const effectiveOutputConfig = outputConfig || loadOutputConfig();
  const scheduled = scheduleContext({ rules: scoredRules, relevantFiles, suggestedSkills, suggestedWorkflows, outputConfig: effectiveOutputConfig });
  const contextEmptyReason = emptyContextReason({ scheduled, outputConfig: effectiveOutputConfig, injectContext });
  const autoWarm = autoWarmWorkspace({
    cwd,
    prompt,
    dataDir,
    reason: contextEmptyReason,
    now: now.getTime()
  });

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
    suggestedSkills,
    suggestedWorkflows,
    telemetry: {
      ...(scored.telemetry || {}),
      rulesInjected: (scheduled.highRules?.length || 0) + (scheduled.midRules?.length || 0),
      filesSuggested: relevantFiles.length,
      skillsSuggested: suggestedSkills.length,
      workflowsSuggested: suggestedWorkflows.length,
      emptyContextReason: contextEmptyReason,
      autoWarm
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

  const additionalContext = injectContext ? scheduled.additionalContext : "";
  const output = {
    continue: true,
    suppressOutput: true
  };
  if (additionalContext) {
    output.hookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext
    };
  }
  return output;
}

function emptyContextReason({ scheduled, outputConfig, injectContext }) {
  if (!injectContext) return "injection-disabled";
  if (scheduled.additionalContext) return null;
  const sections = outputConfig?.sections || {};
  const available = [];
  if ((scheduled.highRules?.length || 0) || (scheduled.midRules?.length || 0)) available.push("rules");
  if (scheduled.relevantFiles?.length) available.push("files");
  if (scheduled.suggestedSkills?.length) available.push("skills");
  if (scheduled.suggestedWorkflows?.length) available.push("workflows");
  if (!available.length) return "no-context-candidates";
  const enabled = available.filter((section) => sections[section] !== false);
  return enabled.length ? "enabled-sections-empty-after-formatting" : `available-sections-disabled:${available.join(",")}`;
}

function emptyScore(telemetry = {}) {
  return {
    scoredRules: [],
    suggestedFiles: [],
    suggestedSkills: [],
    suggestedWorkflows: [],
    telemetry: {
      elapsedMs: 0,
      modelStatus: "skipped",
      rulesParsed: 0,
      rulesInjected: 0,
      filesSuggested: 0,
      skillsSuggested: 0,
      workflowsSuggested: 0,
      ...telemetry
    }
  };
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
