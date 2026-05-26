#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginRuntimeFile } from "../lib/hook-io.js";
import { handleStopPayload } from "../lib/stop-hook.js";
import { appendTelemetry } from "../lib/telemetry.js";

try {
  const payload = await readStdinJson();
  const cwd = payload.cwd || payload.working_directory;
  logDebug("Stop", payload);
  appendTelemetry({ telemetryPath: pluginRuntimeFile("telemetry.jsonl", cwd), event: "Stop", payload });
  writeJson(handleStopPayload(payload, {
    contextPath: pluginRuntimeFile("last-prompt-context.json", cwd),
    reportPath: pluginRuntimeFile("last-report.json", cwd),
    historyPath: pluginRuntimeFile("report-history.jsonl", cwd),
    telemetryPath: pluginRuntimeFile("telemetry.jsonl", cwd)
  }));
} catch (error) {
  failOpen("Stop", error, {
    continue: true
  });
}
