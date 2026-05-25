#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginDataDir } from "../lib/hook-io.js";
import { handlePromptPayload } from "../lib/prompt-hook.js";

const started = Date.now();

try {
  const payload = await readStdinJson();

  logDebug("UserPromptSubmit", payload);
  writeJson(await handlePromptPayload(payload, {
    dataPath: pluginDataDir("last-prompt-context.json"),
    historyPath: pluginDataDir("prompt-history.jsonl"),
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
