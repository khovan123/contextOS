#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginDataDir } from "../lib/hook-io.js";
import { handleStopPayload } from "../lib/stop-hook.js";
import { appendTelemetry } from "../lib/telemetry.js";

try {
  const payload = await readStdinJson();
  logDebug("Stop", payload);
  appendTelemetry({ telemetryPath: pluginDataDir("telemetry.jsonl"), event: "Stop", payload });
  writeJson(handleStopPayload(payload, {
    contextPath: pluginDataDir("last-prompt-context.json"),
    reportPath: pluginDataDir("last-report.json"),
    historyPath: pluginDataDir("report-history.jsonl"),
    telemetryPath: pluginDataDir("telemetry.jsonl")
  }));
} catch (error) {
  failOpen("Stop", error, {
    continue: true
  });
}
