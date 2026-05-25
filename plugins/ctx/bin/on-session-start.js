#!/usr/bin/env node
import { readStdinJson, writeJson, failOpen, logDebug } from "../lib/hook-io.js";

try {
  const payload = await readStdinJson();
  logDebug("SessionStart", payload);
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
