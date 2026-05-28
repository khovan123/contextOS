import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { scoreContext } from "../lib/score-context.js";

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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.telemetry)
        }
      ],
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
