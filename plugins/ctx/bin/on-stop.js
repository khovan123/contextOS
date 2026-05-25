#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginDataDir } from "../lib/hook-io.js";
import { handleStopPayload } from "../lib/stop-hook.js";

try {
  const payload = await readStdinJson();
  logDebug("Stop", payload);
  writeJson(handleStopPayload(payload, {
    contextPath: pluginDataDir("last-prompt-context.json"),
    reportPath: pluginDataDir("last-report.json"),
    historyPath: pluginDataDir("report-history.jsonl")
  }));
} catch (error) {
  failOpen("Stop", error, {
    continue: true
  });
}
