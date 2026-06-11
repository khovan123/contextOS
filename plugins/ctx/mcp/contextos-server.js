import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scoreContext } from "../lib/score-context.js";
import { scheduleContext } from "../lib/scheduler.js";

const CTX_BIN = fileURLToPath(new URL("../../../bin/ctx.js", import.meta.url));

export function createContextOSMcpServer({ dataDir, getHealth = defaultHealth, runCommand = runCliCommand } = {}) {
  const server = new McpServer({
    name: "ctx-mcp",
    version: "0.1.0"
  });

  server.registerTool("ctx_health", {
    title: "ContextOS health",
    description: "Reports ContextOS MCP bridge and embedding model readiness.",
    inputSchema: {},
    outputSchema: {
      model_cache_ready: z.boolean(),
      embedding_pipeline_loaded: z.boolean(),
      bridge_ready: z.boolean(),
      preload_status: z.string().optional(),
      loaded_at: z.number().optional(),
      error: z.string().optional()
    }
  }, async () => {
    const health = getHealth();
    return {
      content: [{ type: "text", text: JSON.stringify(health) }],
      structuredContent: health
    };
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
      suggestedWorkflows: result.suggestedWorkflows,
      prompt: args.prompt || ""
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

  registerCliTool(server, {
    name: "ctx_debug_context",
    title: "Debug ContextOS routing",
    description: "Preview rules, files, skills, workflows, and final prompt context for a task.",
    inputSchema: {
      cwd: z.string().optional(),
      prompt: z.string()
    },
    args: ({ prompt }) => ["debug", "--", prompt],
    runCommand
  });

  registerCliTool(server, {
    name: "ctx_doctor_repo",
    title: "Inspect ContextOS repository readiness",
    description: "Score repository ContextOS readiness without modifying files.",
    inputSchema: {
      cwd: z.string().optional()
    },
    args: () => ["doctor"],
    runCommand
  });

  registerCliTool(server, {
    name: "ctx_skills_doctor",
    title: "Explain ContextOS skill routing",
    description: "Explain which skills ContextOS would select for a prompt and why.",
    inputSchema: {
      cwd: z.string().optional(),
      prompt: z.string()
    },
    args: ({ prompt }) => ["skills", "doctor", "--", prompt],
    runCommand
  });

  registerCliTool(server, {
    name: "ctx_report_last_task",
    title: "Show last ContextOS task report",
    description: "Read the latest local ContextOS compliance report for the workspace.",
    inputSchema: {
      cwd: z.string().optional()
    },
    args: () => ["report"],
    runCommand
  });

  registerCliTool(server, {
    name: "ctx_evidence_last_task",
    title: "Show last ContextOS evidence",
    description: "Read detailed evidence for the latest local ContextOS compliance report.",
    inputSchema: {
      cwd: z.string().optional()
    },
    args: () => ["evidence"],
    runCommand
  });

  registerCliTool(server, {
    name: "ctx_stats_workspace",
    title: "Show ContextOS workspace stats",
    description: "Summarize local ContextOS prompt, report, hook, and telemetry history.",
    inputSchema: {
      cwd: z.string().optional()
    },
    args: () => ["stats"],
    runCommand
  });

  return server;
}

function registerCliTool(server, { name, title, description, inputSchema, args, runCommand }) {
  server.registerTool(name, {
    title,
    description,
    inputSchema,
    outputSchema: {
      code: z.number(),
      stdout: z.string(),
      stderr: z.string()
    }
  }, async (toolArgs) => {
    const result = await runCommand(args(toolArgs), {
      cwd: toolArgs.cwd || process.cwd()
    });
    const text = result.stdout || result.stderr || `(ctx command exited with code ${result.code})`;
    return {
      content: [{ type: "text", text }],
      structuredContent: result
    };
  });
}

function runCliCommand(args, { cwd = process.cwd(), timeoutMs = Number(process.env.CONTEXTOS_MCP_CLI_TOOL_TIMEOUT_MS || 10000) } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CTX_BIN, ...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: stderr || `ctx command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error?.message || String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function defaultHealth() {
  return {
    model_cache_ready: false,
    embedding_pipeline_loaded: false,
    bridge_ready: false,
    preload_status: "unknown"
  };
}
