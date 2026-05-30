import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { scoreContext } from "../lib/score-context.js";
import { scheduleContext } from "../lib/scheduler.js";

export function createContextOSMcpServer({ dataDir }) {
  const server = new McpServer({
    name: "ctx-mcp",
    version: "0.1.0"
  });

  server.registerTool("ctx_score_context", {
    title: "Score ContextOS prompt context",
    description: "Scores AGENTS.md rules and suggests files/skills for an agent prompt.",
    inputSchema: {
      cwd: z.string().optional(),
      prompt: z.string(),
      openFiles: z.array(z.string()).optional(),
      maxFiles: z.number().int().positive().max(20).optional(),
      maxSkills: z.number().int().positive().max(10).optional(),
      maxWorkflows: z.number().int().positive().max(10).optional(),
      skills: z.array(z.object({
        name: z.string(),
        description: z.string(),
        path: z.string().optional()
      })).optional(),
      workflows: z.array(z.object({
        name: z.string(),
        title: z.string().optional(),
        description: z.string(),
        chain: z.array(z.string()).optional(),
        path: z.string().optional()
      })).optional()
    },
    outputSchema: {
      scoredRules: z.array(z.any()),
      suggestedFiles: z.array(z.any()),
      suggestedSkills: z.array(z.any()),
      suggestedWorkflows: z.array(z.any()),
      telemetry: z.record(z.string(), z.any())
    }
  }, async (args) => {
    const result = await scoreContext({
      cwd: args.cwd || process.cwd(),
      prompt: args.prompt || "",
      openFiles: args.openFiles || [],
      dataDir,
      maxFiles: args.maxFiles || 5,
      maxSkills: args.maxSkills || 3,
      maxWorkflows: args.maxWorkflows || 2,
      skills: args.skills,
      workflows: args.workflows
    });

    // Format the same human-readable context that the hook path produces
    const scheduled = scheduleContext({
      rules: result.scoredRules,
      relevantFiles: result.suggestedFiles,
      suggestedSkills: result.suggestedSkills,
      suggestedWorkflows: result.suggestedWorkflows
    });

    const contextText = scheduled.additionalContext || "";
    const contentBlocks = [];

    // Primary block: human-readable rules, files, skills, workflows
    if (contextText) {
      contentBlocks.push({ type: "text", text: contextText });
    }

    // Secondary block: telemetry metadata
    contentBlocks.push({
      type: "text",
      text: JSON.stringify(result.telemetry)
    });

    return {
      content: contentBlocks,
      structuredContent: {
        scoredRules: result.scoredRules,
        suggestedFiles: result.suggestedFiles,
        suggestedSkills: result.suggestedSkills,
        suggestedWorkflows: result.suggestedWorkflows,
        telemetry: result.telemetry
      }
    };
  });

  return server;
}

