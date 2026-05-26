import fs from "node:fs";

import { appendJsonLine, readJsonFile, writeJsonFile } from "./fs-utils.js";
import { readGitSnapshot, checkCompliance } from "./measure.js";
import { buildReport, formatReport } from "./reporter.js";
import { loadRuntimeEvidence } from "./telemetry.js";
import { filterActionableRules } from "./analyzer.js";

export function handleStopPayload(payload, { contextPath, reportPath, historyPath, telemetryPath } = {}) {
  const cwd = payload.cwd || payload.working_directory || process.cwd();
  const promptContext = contextPath && fs.existsSync(contextPath) ? readJsonFile(contextPath) : null;
  const rawScheduledRules = [
    ...(promptContext?.scheduled?.highRules || []),
    ...(promptContext?.scheduled?.midRules || [])
  ];
  const scheduledRules = filterActionableRules(rawScheduledRules);
  const scheduled = promptContext?.scheduled
    ? {
      ...promptContext.scheduled,
      highRules: filterActionableRules(promptContext.scheduled.highRules || []),
      midRules: filterActionableRules(promptContext.scheduled.midRules || []),
      droppedRules: [
        ...(promptContext.scheduled.droppedRules || []),
        ...rawScheduledRules.filter((rule) => !scheduledRules.some((item) => item.content === rule.content && item.sourcePath === rule.sourcePath))
      ]
    }
    : null;
  const gitSnapshot = readGitSnapshot({ cwd });
  const runtimeEvidence = loadRuntimeEvidence({
    telemetryPath,
    since: promptContext?.at,
    cwd,
    payload
  });
  const compliance = checkCompliance({
    rules: scheduledRules,
    addedLines: gitSnapshot.addedLines,
    runtimeEvidence
  });
  const report = buildReport({
    cwd,
    prompt: promptContext?.prompt || "",
    relevantFiles: promptContext?.relevantFiles || [],
    scheduled,
    gitSnapshot,
    compliance,
    runtimeEvidence
  });

  if (reportPath) writeJsonFile(reportPath, report);
  if (historyPath) appendJsonLine(historyPath, report);

  return {
    continue: true,
    systemMessage: formatReport(report)
  };
}
