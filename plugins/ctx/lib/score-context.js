import path from "node:path";

import { readAgentsChain } from "./reader.js";
import { filterActionableRules, parseRules, scoreRules, findRelevantFiles } from "./analyzer.js";
import { enhanceRuleScoresWithEmbeddings } from "./embedding-scorer.js";
import { scanSkills, suggestSkills } from "./skill-discoverer.js";

export async function scoreContext({
  cwd = process.cwd(),
  prompt = "",
  openFiles = [],
  dataDir,
  maxFiles = 5,
  maxSkills = 3,
  skills = null,
  embeddingTimeoutMs = 5000,
  fileEmbeddingTimeoutMs = Number(process.env.CONTEXTOS_FILE_EMBEDDING_TIMEOUT_MS || 80)
} = {}) {
  const started = Date.now();
  const merged = readAgentsChain({ cwd });
  const rawRules = parseRules(merged.content);
  const parsedRules = filterActionableRules(rawRules);
  const baseScoredRules = scoreRules(parsedRules, prompt, openFiles);
  const embedding = await enhanceRuleScoresWithEmbeddings(baseScoredRules, prompt, {
    dataDir,
    sources: merged.sources,
    timeoutMs: embeddingTimeoutMs,
    allowRemote: false
  });
  const scoredRules = embedding.rules;
  const suggestedFiles = await findRelevantFiles({
    cwd,
    task: prompt,
    rules: scoredRules,
    dataDir,
    limit: maxFiles,
    fileEmbeddingTimeoutMs,
    fileEmbeddingOptions: {
      allowRemote: false
    }
  });
  const skillCatalog = Array.isArray(skills) ? skills : scanSkills({ cwd });
  const suggestedSkills = await suggestSkills({
    prompt,
    skills: skillCatalog,
    dataDir,
    limit: maxSkills
  });

  return {
    cwd,
    prompt,
    scoredRules,
    suggestedFiles,
    suggestedSkills,
    telemetry: {
      elapsedMs: Date.now() - started,
      modelStatus: embedding.status,
      model: embedding.model,
      cachePath: embedding.cachePath,
      rulesParsed: parsedRules.length,
      rulesFiltered: rawRules.length - parsedRules.length,
      rulesInjected: scoredRules.filter((rule) => Number(rule.score || 0) >= 0.1).length,
      filesSuggested: suggestedFiles.length,
      skillsScanned: skillCatalog.length,
      skillsSuggested: suggestedSkills.length,
      sources: merged.sources.map((source) => path.relative(cwd, source))
    }
  };
}
