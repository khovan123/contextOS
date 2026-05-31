import fs from "node:fs";
import path from "node:path";

import { writeJsonFile } from "./fs-utils.js";
import { defaultDataRoot } from "./workspace-data.js";

const CONFIG_FILE = "output-config.json";

export const OUTPUT_SECTION_OPTIONS = [
  { value: "rules", label: "Critical ContextOS rules", hint: "Include critical and additional relevant AGENTS.md rules." },
  { value: "files", label: "Suggested files to check", hint: "Include semantic, import-graph, and code-review-graph file suggestions." },
  { value: "skills", label: "Suggested skills for this task", hint: "Include matching local skill recommendations." },
  { value: "workflows", label: "Suggested workflow for this task", hint: "Include matching workflow recommendations." }
];

export function defaultOutputConfig() {
  return {
    sections: Object.fromEntries(OUTPUT_SECTION_OPTIONS.map((option) => [option.value, true]))
  };
}

export function outputConfigPath(dataRoot = defaultDataRoot()) {
  return path.join(dataRoot, CONFIG_FILE);
}

export function loadOutputConfig({ dataRoot = defaultDataRoot() } = {}) {
  try {
    return normalizeOutputConfig(JSON.parse(fs.readFileSync(outputConfigPath(dataRoot), "utf8")));
  } catch {
    return defaultOutputConfig();
  }
}

export function saveOutputConfig(config, { dataRoot = defaultDataRoot() } = {}) {
  const normalized = normalizeOutputConfig(config);
  writeJsonFile(outputConfigPath(dataRoot), normalized);
  return normalized;
}

export async function configureOutputSections({
  dataRoot = defaultDataRoot(),
  select,
  logger = console.log
} = {}) {
  if (typeof select !== "function") throw new Error("configureOutputSections requires a multi-select function");
  const current = loadOutputConfig({ dataRoot });
  const selected = await select({
    message: "Select ContextOS prompt sections to show:",
    options: OUTPUT_SECTION_OPTIONS.map((option) => ({
      ...option,
      selected: current.sections[option.value]
    }))
  });
  const selectedSet = new Set(selected);
  const saved = saveOutputConfig({
    sections: Object.fromEntries(OUTPUT_SECTION_OPTIONS.map((option) => [option.value, selectedSet.has(option.value)]))
  }, { dataRoot });
  logger(`│  Saved ContextOS prompt section config: ${outputConfigPath(dataRoot)}`);
  logger(`│  Enabled sections: ${selected.length ? selected.join(", ") : "(none)"}`);
  return saved;
}

function normalizeOutputConfig(config = {}) {
  const defaults = defaultOutputConfig();
  return {
    sections: Object.fromEntries(OUTPUT_SECTION_OPTIONS.map((option) => [
      option.value,
      typeof config.sections?.[option.value] === "boolean"
        ? config.sections[option.value]
        : defaults.sections[option.value]
    ]))
  };
}
