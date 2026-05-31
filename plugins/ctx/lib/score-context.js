import path from "node:path";

import { readAgentsChain } from "./reader.js";
import { filterActionableRules, parseRules, scoreRules, findRelevantFiles } from "./analyzer.js";
import { enhanceRuleScoresWithEmbeddings } from "./embedding-scorer.js";
import { scanSkills, suggestSkills } from "./skill-discoverer.js";
import { scanWorkflows, suggestWorkflows } from "./workflow-discoverer.js";

export async function scoreContext({
  cwd = process.cwd(),
  prompt = "",
  openFiles = [],
  dataDir,
  maxFiles = 5,
  maxSkills = 3,
  maxWorkflows = 2,
  skills = null,
  workflows = null,
  embeddingTimeoutMs = 5000,
  fileEmbeddingTimeoutMs = Number(process.env.CONTEXTOS_FILE_EMBEDDING_TIMEOUT_MS || 1000)
} = {}) {
  const started = Date.now();
  const ruleInputsPromise = Promise.resolve().then(() => {
    const merged = readAgentsChain({ cwd });
    const rawRules = parseRules(merged.content);
    const parsedRules = filterActionableRules(rawRules);
    return {
      merged,
      rawRules,
      parsedRules,
      baseScoredRules: scoreRules(parsedRules, prompt, openFiles)
    };
  });

  const rulesPromise = ruleInputsPromise.then(({ merged, baseScoredRules }) => {
    return enhanceRuleScoresWithEmbeddings(baseScoredRules, prompt, {
      dataDir,
      sources: merged.sources,
      timeoutMs: embeddingTimeoutMs,
      allowRemote: false
    });
  });

  const filesPromise = ruleInputsPromise.then(({ baseScoredRules }) => {
    return findRelevantFiles({
      cwd,
      task: prompt,
      rules: baseScoredRules,
      dataDir,
      limit: maxFiles,
      fileEmbeddingTimeoutMs,
      fileEmbeddingOptions: {
        allowRemote: false
      }
    });
  });

  const skillsPromise = Promise.resolve().then(async () => {
    const catalog = Array.isArray(skills) ? skills : scanSkills({ cwd });
    return {
      catalog,
      suggestions: await suggestSkills({ cwd, prompt, skills: catalog, dataDir, limit: maxSkills })
    };
  });

  const workflowsPromise = Promise.resolve().then(async () => {
    const catalog = Array.isArray(workflows) ? workflows : scanWorkflows({ cwd });
    return {
      catalog,
      suggestions: await suggestWorkflows({ prompt, workflows: catalog, dataDir, limit: maxWorkflows })
    };
  });

  const [ruleInputs, embedding, suggestedFiles, skillResult, workflowResult] = await Promise.all([
    ruleInputsPromise,
    rulesPromise,
    filesPromise,
    skillsPromise,
    workflowsPromise
  ]);
  const { merged, rawRules, parsedRules } = ruleInputs;
  const scoredRules = embedding.rules;
  const skillCatalog = skillResult.catalog;
  const suggestedSkills = skillResult.suggestions;
  const workflowCatalog = workflowResult.catalog;
  const suggestedWorkflows = workflowResult.suggestions;

  return {
    cwd,
    prompt,
    scoredRules,
    suggestedFiles,
    suggestedSkills,
    suggestedWorkflows,
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
      workflowsScanned: workflowCatalog.length,
      workflowsSuggested: suggestedWorkflows.length,
      sources: merged.sources.map((source) => path.relative(cwd, source))
    }
  };
}
