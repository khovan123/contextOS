import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillFrontmatter, projectSkillHints, scanSkills, suggestSkills } from "../plugins/ctx/lib/skill-discoverer.js";

describe("skill discoverer", () => {
  it("parses SKILL.md YAML frontmatter", () => {
    const skill = parseSkillFrontmatter([
      "---",
      "name: payment-integration",
      "description: Use when building payment provider webhooks and checkout flows.",
      "---",
      "",
      "# Payment"
    ].join("\n"), {
      fallbackName: "fallback",
      skillPath: "/repo/.claude/skills/payment-integration/SKILL.md"
    });

    expect(skill).toMatchObject({
      name: "payment-integration",
      description: "Use when building payment provider webhooks and checkout flows.",
      path: "/repo/.claude/skills/payment-integration/SKILL.md"
    });
  });

  it("falls back to directory name and first body paragraph", () => {
    const skill = parseSkillFrontmatter("# Debugger\n\nUse for root cause analysis.", {
      skillPath: "/repo/.codex/skills/debugger/SKILL.md"
    });

    expect(skill.name).toBe("debugger");
    expect(skill.description).toBe("Debugger");
  });

  it("truncates very long descriptions before scoring", () => {
    const skill = parseSkillFrontmatter([
      "---",
      "name: huge-skill",
      `description: ${"long ".repeat(300)}`,
      "---"
    ].join("\n"), {
      skillPath: "/repo/.codex/skills/huge-skill/SKILL.md"
    });

    expect(skill.description.length).toBeLessThanOrEqual(500);
  });


  it("scans global/project style skill directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skills-"));
    const skillDir = path.join(tmp, ".claude", "skills", "planning");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: planning",
      "description: Use for task breakdown and architecture decisions.",
      "---"
    ].join("\n"));

    const skills = scanSkills({
      cwd: tmp,
      roots: [path.join(tmp, ".claude", "skills")]
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "planning" });
  });

  it("scans Antigravity skill directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agy-skills-"));
    const skillDir = path.join(tmp, ".gemini", "antigravity", "skills", "payment-integration");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: payment-integration",
      "description: Use for payment checkout and billing webhook tasks.",
      "---"
    ].join("\n"));

    const skills = scanSkills({
      cwd: tmp,
      roots: [path.join(tmp, ".gemini", "antigravity", "skills")]
    });

    expect(skills.map((skill) => skill.name)).toContain("payment-integration");
  });

  it("caches scans even when the max skill limit is reached", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-cache-"));
    const root = path.join(tmp, ".codex", "skills");
    writeSkill(path.join(root, "one"), "one");
    writeSkill(path.join(root, "two"), "two");

    const first = scanSkills({ cwd: tmp, roots: [root], maxSkills: 1 });
    fs.rmSync(path.join(root, "one"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "two"), { recursive: true, force: true });
    const second = scanSkills({ cwd: tmp, roots: [root], maxSkills: 1 });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe(first[0].name);
  });

  it("suggests top skills without being affected by catalog size/order", async () => {
    const skills = Array.from({ length: 50 }, (_, index) => ({
      name: `zzz-${index}`,
      description: "Use for unrelated infrastructure maintenance.",
      path: `/skills/zzz-${index}/SKILL.md`
    }));
    skills.push({
      name: "payment-integration",
      description: "Use when creating payment provider integrations, checkout sessions, billing webhooks, and invoices.",
      path: "/skills/payment-integration/SKILL.md"
    });

    const suggested = await suggestSkills({
      prompt: "create a new payment integration with checkout webhook",
      skills,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-data-")),
      limit: 3,
      timeoutMs: 1
    });

    expect(suggested[0].name).toBe("payment-integration");
  });

  it("does not suggest unrelated skills from generic setup and package tokens", async () => {
    const skills = Array.from({ length: 301 }, (_, index) => ({
      name: `unrelated-${index}`,
      description: "Use for unrelated maintenance tasks.",
      path: `/skills/unrelated-${index}/SKILL.md`
    }));
    skills.push(
      {
        name: "azure-postgres-ts",
        description: "Connect to Azure Database for PostgreSQL Flexible Server from Node.js using the pg package.",
        path: "/skills/azure-postgres-ts/SKILL.md"
      },
      {
        name: "devcontainer-setup",
        description: "Use when setting up isolated Node.js development environments.",
        path: "/skills/devcontainer-setup/SKILL.md"
      }
    );

    const suggested = await suggestSkills({
      prompt: "ctx setup sync package rebuild graph embeddings",
      skills,
      limit: 3
    });

    expect(suggested).toEqual([]);
  });

  it("deduplicates repeated skill names across roots", async () => {
    const suggested = await suggestSkills({
      prompt: "create payment checkout webhook integration",
      skills: [
        {
          name: "payment-integration",
          description: "Use when creating payment checkout sessions and billing webhooks.",
          path: "/skills/one/payment-integration/SKILL.md"
        },
        {
          name: "payment-integration",
          description: "Use when creating payment checkout sessions and billing webhooks.",
          path: "/skills/two/payment-integration/SKILL.md"
        }
      ],
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-dedupe-")),
      timeoutMs: 1
    });

    expect(suggested.map((skill) => skill.name)).toEqual(["payment-integration"]);
  });

  it("prefers Expo EAS workflow skills using bounded project hints", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-expo-"));
    fs.mkdirSync(path.join(cwd, "webapp"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      workspaces: ["webapp"]
    }));
    fs.writeFileSync(path.join(cwd, "webapp", "package.json"), JSON.stringify({
      dependencies: { expo: "^53.0.0", "react-native": "^0.79.0" }
    }));
    fs.writeFileSync(path.join(cwd, "webapp", "eas.json"), "{}");

    const suggested = await suggestSkills({
      cwd,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-expo-cache-")),
      timeoutMs: 1,
      prompt: "handle https://github.com/example/app/issues/116 EAS config iOS Android preview production",
      skills: [
        {
          name: "audit-skills",
          description: "Audit mobile Android and iOS applications.",
          path: "/skills/audit/SKILL.md"
        },
        {
          name: "expo-api-routes",
          description: "Create Expo Router API routes with EAS Hosting.",
          path: "/skills/expo-api/SKILL.md"
        },
        {
          name: "llm-app-patterns",
          description: "Production-ready LLM patterns inspired by https://github.com/example/llm.",
          path: "/skills/llm/SKILL.md"
        },
        {
          name: "expo-cicd-workflows",
          description: "Write EAS workflow YAML files for Expo projects and build pipelines.",
          path: "/skills/expo/SKILL.md"
        }
      ]
    });

    expect(projectSkillHints({ cwd })).toEqual(expect.arrayContaining(["expo", "react", "native", "eas", "json"]));
    expect(suggested[0].name).toBe("expo-cicd-workflows");
    expect(suggested.map((skill) => skill.name)).not.toContain("audit-skills");
  });

  it("suggests frontend and auth skills for Vietnamese role-based UI prompts", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-next-role-"));
    fs.mkdirSync(path.join(cwd, "webapp"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      workspaces: ["webapp"]
    }));
    fs.writeFileSync(path.join(cwd, "webapp", "package.json"), JSON.stringify({
      dependencies: { next: "^15.0.0", react: "^19.0.0", tailwindcss: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" }
    }));

    const suggested = await suggestSkills({
      cwd,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-next-role-cache-")),
      timeoutMs: 1,
      prompt: "triển khai giao diện theo role, webapp/src/app/(private)/dashboard chỉ dành cho role ADMIN, CREATOR mới có button create page",
      skills: [
        ...Array.from({ length: 301 }, (_, index) => ({
          name: `unrelated-${index}`,
          description: "Use for unrelated maintenance tasks.",
          path: `/skills/unrelated-${index}/SKILL.md`
        })),
        {
          name: "frontend-developer",
          description: "Build React components, implement responsive layouts, and handle client-side state management. Masters React 19, Next.js 15, and modern frontend architecture.",
          path: "/skills/frontend-developer/SKILL.md"
        },
        {
          name: "frontend-ui-dark-ts",
          description: "A modern dark-themed React UI system using Tailwind CSS and Framer Motion for dashboards, admin panels, and glassmorphism interfaces.",
          path: "/skills/frontend-ui-dark-ts/SKILL.md"
        },
        {
          name: "nextjs-app-router-patterns",
          description: "Comprehensive patterns for Next.js 14+ App Router architecture, Server Components, routing, and modern full-stack React development.",
          path: "/skills/nextjs-app-router-patterns/SKILL.md"
        },
        {
          name: "nextjs-best-practices",
          description: "Next.js App Router principles. Server Components, data fetching, routing patterns.",
          path: "/skills/nextjs-best-practices/SKILL.md"
        },
        {
          name: "react-nextjs-development",
          description: "React and Next.js 14+ application development with App Router, Server Components, TypeScript, Tailwind CSS, and modern frontend patterns.",
          path: "/skills/react-nextjs-development/SKILL.md"
        },
        {
          name: "auth-implementation-patterns",
          description: "Build secure authentication and authorization systems with role-based access control and permission checks.",
          path: "/skills/auth/SKILL.md"
        },
        {
          name: "azure-postgres-ts",
          description: "Connect to Azure Database for PostgreSQL Flexible Server from Node.js using the pg package.",
          path: "/skills/azure-postgres-ts/SKILL.md"
        }
      ],
      limit: 3
    });

    expect(suggested.map((skill) => skill.name)).toEqual([
      "nextjs-app-router-patterns",
      "nextjs-best-practices",
      "react-nextjs-development"
    ]);
  });

  it("suggests Expo runtime skills for QR/connect run prompts in Expo projects", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-expo-qr-"));
    fs.mkdirSync(path.join(cwd, "webapp"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      workspaces: ["webapp"],
      description: "React Native frontend"
    }));
    fs.writeFileSync(path.join(cwd, "webapp", "package.json"), JSON.stringify({
      dependencies: {
        expo: "^56.0.0",
        "expo-router": "^6.0.0",
        nativewind: "^5.0.0",
        react: "^19.0.0",
        "react-native": "^0.85.0"
      },
      devDependencies: {
        tailwindcss: "^4.0.0"
      }
    }));
    fs.writeFileSync(path.join(cwd, "webapp", "app.json"), "{}");
    fs.writeFileSync(path.join(cwd, "webapp", "eas.json"), "{}");

    const suggested = await suggestSkills({
      cwd,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-expo-qr-cache-")),
      timeoutMs: 1,
      prompt: "why run can not show QR or something to connect webapp",
      skills: [
        ...Array.from({ length: 301 }, (_, index) => ({
          name: `unrelated-${index}`,
          description: "Use for unrelated maintenance tasks.",
          path: `/skills/unrelated-${index}/SKILL.md`
        })),
        {
          name: "expo-deployment",
          description: "Deploy Expo apps to production with EAS Build, production build settings, app stores, OTA updates, and release channels.",
          path: "/skills/expo-deployment/SKILL.md"
        },
        {
          name: "building-native-ui",
          description: "Complete guide for building beautiful apps with Expo Router. Covers running the app, Expo Go, QR code scanning, styling, components, and navigation.",
          path: "/skills/building-native-ui/SKILL.md"
        },
        {
          name: "expo-tailwind-setup",
          description: "Set up Tailwind CSS v4 in Expo with react-native-css and NativeWind v5 for universal styling.",
          path: "/skills/expo-tailwind-setup/SKILL.md"
        },
        {
          name: "frontend-design",
          description: "You are a frontend designer-engineer, not a layout generator.",
          path: "/skills/frontend-design/SKILL.md"
        },
        {
          name: "react-nextjs-development",
          description: "React and Next.js application development with App Router, Server Components, TypeScript, Tailwind CSS, and modern frontend patterns.",
          path: "/skills/react-nextjs-development/SKILL.md"
        }
      ],
      limit: 3
    });

    expect(suggested.map((skill) => skill.name)).toEqual([
      "expo-deployment",
      "building-native-ui",
      "expo-tailwind-setup"
    ]);
  });

  it("suggests commerce and app integration skills for purchase flows without generic domain bleed", async () => {
    const skills = [
      ...Array.from({ length: 301 }, (_, index) => ({
        name: `unrelated-${index}`,
        description: "Use for unrelated maintenance tasks.",
        path: `/skills/unrelated-${index}/SKILL.md`
      })),
      {
        name: "mcp-management",
        description: "Manage MCP servers and tool access for agent workflows.",
        path: "/skills/mcp-management/SKILL.md"
      },
      {
        name: "metasploit-framework",
        description: "Use for penetration testing, exploitation, and security assessment workflows.",
        path: "/skills/metasploit-framework/SKILL.md"
      },
      {
        name: "better-auth",
        description: "Implement authentication and authorization with a TypeScript auth framework.",
        path: "/skills/better-auth/SKILL.md"
      },
      {
        name: "payment-integration",
        description: "Use when creating payment checkout sessions, wallet flows, billing webhooks, and invoices.",
        path: "/skills/payment-integration/SKILL.md"
      },
      {
        name: "billing-automation",
        description: "Master automated billing systems including invoice generation, balance checks, and payment retries.",
        path: "/skills/billing-automation/SKILL.md"
      },
      {
        name: "frontend-api-integration-patterns",
        description: "Production-ready patterns for integrating frontend applications with backend APIs, including modals and checkout state.",
        path: "/skills/frontend-api-integration-patterns/SKILL.md"
      },
      {
        name: "api-endpoint-builder",
        description: "Build production-ready REST API endpoints with validation, authentication, and service integration.",
        path: "/skills/api-endpoint-builder/SKILL.md"
      },
      {
        name: "wordpress-woocommerce-development",
        description: "Build WooCommerce stores with WordPress payment checkout, order processing, and ecommerce APIs.",
        path: "/skills/wordpress-woocommerce-development/SKILL.md"
      }
    ];

    const suggested = await suggestSkills({
      prompt: [
        "Implement the purchase flow for resources, tutorials, resource collections, and tutorial collections.",
        "Before purchase, check whether the user's wallet balance is sufficient.",
        "If the balance is insufficient, display a modal prompting the user to top up their wallet before proceeding to checkout.",
        "Upon successful payment, grant access permissions through the content-access-service.",
        "The purchased content must automatically appear in the user's /library.",
        "Send notifications to both the buyer and the seller after a successful purchase."
      ].join(" "),
      skills,
      limit: 5
    });

    const names = suggested.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining([
      "payment-integration",
      "billing-automation",
      "frontend-api-integration-patterns",
      "api-endpoint-builder"
    ]));
    expect(names).not.toContain("mcp-management");
    expect(names).not.toContain("metasploit-framework");
    expect(names).not.toContain("wordpress-woocommerce-development");
  });

  it("uses MCP project metadata for context retrieval debugging prompts", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-mcp-project-"));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      keywords: ["context", "hooks", "mcp", "semantic-search"],
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0"
      }
    }));

    const suggested = await suggestSkills({
      cwd,
      prompt: "can not see suggested skills / files, suggested skills not match prompt",
      skills: [
        ...Array.from({ length: 301 }, (_, index) => ({
          name: `unrelated-${index}`,
          description: "Use for unrelated maintenance tasks.",
          path: `/skills/unrelated-${index}/SKILL.md`
        })),
        {
          name: "mcp-builder",
          description: "Create MCP Model Context Protocol servers that enable LLMs to interact with external services through tools.",
          path: "/skills/mcp-builder/SKILL.md"
        },
        {
          name: "mcp-management",
          description: "Manage Model Context Protocol MCP servers, tools, prompts, resources, and MCP client integrations.",
          path: "/skills/mcp-management/SKILL.md"
        },
        {
          name: "mcp-tool-developer",
          description: "Build Model Context Protocol MCP servers and tools from scratch.",
          path: "/skills/mcp-tool-developer/SKILL.md"
        },
        {
          name: "agent-memory-mcp",
          description: "A hybrid memory system for AI agents that runs as an MCP server.",
          path: "/skills/agent-memory-mcp/SKILL.md"
        }
      ],
      limit: 7
    });

    expect(projectSkillHints({ cwd })).toEqual(expect.arrayContaining(["mcp", "modelcontextprotocol"]));
    expect(suggested.map((skill) => skill.name)).toEqual([
      "mcp-builder",
      "mcp-management",
      "mcp-tool-developer",
      "agent-memory-mcp"
    ]);
  });

  it("reads package metadata across monorepo workspace globs", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-monorepo-hints-"));
    fs.mkdirSync(path.join(cwd, "apps", "mobile"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "libs", "shared"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      workspaces: {
        packages: ["apps/*", "libs/*"]
      },
      scripts: {
        "mobile:start": "npm run start -w apps/mobile"
      }
    }));
    fs.writeFileSync(path.join(cwd, "apps", "mobile", "package.json"), JSON.stringify({
      scripts: {
        start: "expo start",
        web: "expo start --web"
      },
      dependencies: {
        expo: "^56.0.0",
        "expo-router": "^6.0.0",
        nativewind: "^5.0.0",
        "react-native": "^0.85.0"
      },
      devDependencies: {
        tailwindcss: "^4.0.0"
      }
    }));
    fs.writeFileSync(path.join(cwd, "libs", "shared", "package.json"), JSON.stringify({
      dependencies: {
        zod: "^4.0.0"
      }
    }));
    fs.writeFileSync(path.join(cwd, "apps", "mobile", "app.config.js"), "export default {};\n");

    expect(projectSkillHints({ cwd })).toEqual(expect.arrayContaining([
      "expo",
      "start",
      "nativewind",
      "react",
      "native",
      "tailwindcss",
      "zod",
      "app",
      "config"
    ]));
  });
});

function writeSkill(directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: Use for ${name} tasks.`,
    "---"
  ].join("\n"));
}
