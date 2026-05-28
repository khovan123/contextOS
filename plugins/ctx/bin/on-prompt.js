#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginRuntimeFile, pluginDataRoot, resolveHookCwd } from "../lib/hook-io.js";
import { handlePromptPayload } from "../lib/prompt-hook.js";
import { appendTelemetry } from "../lib/telemetry.js";

const started = Date.now();

try {
  const payload = await readStdinJson();
  const cwd = resolveHookCwd(payload);
  const normalized = { ...payload, cwd };

  logDebug("UserPromptSubmit", normalized);
  appendTelemetry({ telemetryPath: pluginRuntimeFile("telemetry.jsonl", cwd), event: "UserPromptSubmit", payload: normalized });
  writeJson(await handlePromptPayload(normalized, {
    dataPath: pluginRuntimeFile("last-prompt-context.json", cwd),
    historyPath: pluginRuntimeFile("prompt-history.jsonl", cwd),
    mcpDataDir: pluginDataRoot(),
    started
  }));
} catch (error) {
  failOpen("UserPromptSubmit", error, {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ""
    }
  });
}
