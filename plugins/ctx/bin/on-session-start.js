#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug, pluginDataDir } from "../lib/hook-io.js";
import { appendTelemetry } from "../lib/telemetry.js";

try {
  const payload = await readStdinJson();
  logDebug("SessionStart", payload);
  appendTelemetry({ telemetryPath: pluginDataDir("telemetry.jsonl"), event: "SessionStart", payload });
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
