#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginRuntimeFile } from "../lib/hook-io.js";
import { appendTelemetry } from "../lib/telemetry.js";

try {
  const payload = await readStdinJson();
  const cwd = payload.cwd || payload.working_directory;
  logDebug("SessionStart", payload);
  appendTelemetry({ telemetryPath: pluginRuntimeFile("telemetry.jsonl", cwd), event: "SessionStart", payload });
  writeJson({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart"
    }
  });
} catch (error) {
  failOpen("SessionStart", error, {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart"
    }
  });
}
