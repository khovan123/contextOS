import fs from "node:fs";
import path from "node:path";

const DEFAULT_EXCLUDES = new Set(["ctx-mcp"]);

export function installMcpTelemetryProxies({ codexHome, marketplaceRoot, targets = null, excludes = DEFAULT_EXCLUDES } = {}) {
  const configPath = path.join(codexHome, "config.toml");
  if (!fs.existsSync(configPath)) return { wrapped: [], skipped: [], configPath };

  const original = fs.readFileSync(configPath, "utf8");
  const proxyPath = path.join(marketplaceRoot, "plugins", "ctx", "mcp", "proxy.js");
  const result = rewriteMcpTelemetryProxies(original, { proxyPath, targets, excludes });
  if (result.content !== original) {
    fs.writeFileSync(configPath, result.content, "utf8");
  }
  return { ...result, configPath };
}

export function rewriteMcpTelemetryProxies(toml, { proxyPath, targets = null, excludes = DEFAULT_EXCLUDES } = {}) {
  const lines = String(toml || "").split(/\r?\n/);
  const sections = findMcpServerSections(lines);
  const wrapped = [];
  const skipped = [];

  for (const section of sections.reverse()) {
    const body = lines.slice(section.start + 1, section.end);
    const command = findStringValue(body, "command");
    const args = findArrayValue(body, "args") || [];
    const shouldProxy = shouldProxyServer(section.name, { targets, excludes });

    if (command === "node" && args[0] === proxyPath && !shouldProxy) {
      const original = unwrapProxyArgs(args);
      if (original) {
        const nextBody = replaceOrInsertServerField(
          replaceOrInsertServerField(body, "command", tomlString(original.command)),
          "args",
          tomlArray(original.args)
        );
        lines.splice(section.start + 1, section.end - section.start - 1, ...nextBody);
        skipped.push({ name: section.name, reason: "unwrapped-non-target" });
        continue;
      }
    }

    if (!shouldProxy) {
      skipped.push({ name: section.name, reason: "not-targeted" });
      continue;
    }

    if (!command) {
      skipped.push({ name: section.name, reason: "missing-command" });
      continue;
    }
    if (command === "node" && args[0] === proxyPath) {
      skipped.push({ name: section.name, reason: "already-wrapped" });
      continue;
    }

    const nextBody = replaceOrInsertServerField(
      replaceOrInsertServerField(body, "command", tomlString("node")),
      "args",
      tomlArray([proxyPath, "--name", section.name, "--", command, ...args])
    );
    lines.splice(section.start + 1, section.end - section.start - 1, ...nextBody);
    wrapped.push({ name: section.name, command, args });
  }

  return { content: lines.join("\n"), wrapped: wrapped.reverse(), skipped: skipped.reverse() };
}

function shouldProxyServer(name, { targets, excludes }) {
  if (targets instanceof Set) return targets.has(name);
  if (Array.isArray(targets)) return targets.includes(name);
  return !(excludes || DEFAULT_EXCLUDES).has(name);
}

function unwrapProxyArgs(args) {
  const separator = args.indexOf("--");
  if (separator < 0 || separator >= args.length - 1) return null;
  return {
    command: args[separator + 1],
    args: args.slice(separator + 2)
  };
}

function findMcpServerSections(lines) {
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[mcp_servers\.([^\].]+)\]\s*$/);
    if (!match) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\[/.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    sections.push({ name: unquoteTomlKey(match[1]), start: index, end });
  }
  return sections;
}

function replaceOrInsertServerField(body, key, value) {
  const next = [...body];
  const index = next.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line));
  const line = `${key} = ${value}`;
  if (index >= 0) next[index] = line;
  else next.unshift(line);
  return next;
}

function findStringValue(lines, key) {
  const line = lines.find((item) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(item));
  if (!line) return null;
  const match = line.match(/=\s*"((?:\\.|[^"\\])*)"/);
  return match ? unescapeTomlString(match[1]) : null;
}

function findArrayValue(lines, key) {
  const line = lines.find((item) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(item));
  if (!line) return null;
  const arrayMatch = line.match(/=\s*\[(.*)\]\s*$/);
  if (!arrayMatch) return null;
  const values = [];
  const pattern = /"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = pattern.exec(arrayMatch[1]))) values.push(unescapeTomlString(match[1]));
  return values;
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unescapeTomlString(value) {
  return String(value).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function unquoteTomlKey(value) {
  return value.replace(/^"|"$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
