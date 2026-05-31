import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  configureOutputSections,
  defaultOutputConfig,
  enabledOutputSections,
  enabledOutputSectionsLabel,
  loadOutputConfig,
  outputConfigPath,
  saveOutputConfig
} from "../plugins/ctx/lib/output-config.js";

describe("output config", () => {
  it("defaults every prompt section to enabled", () => {
    expect(defaultOutputConfig()).toEqual({
      sections: {
        rules: true,
        files: true,
        skills: true,
        workflows: true
      }
    });
  });

  it("persists selected prompt sections from the multi-select panel", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-output-config-"));
    let options;
    const logs = [];
    const saved = await configureOutputSections({
      dataRoot,
      select: async (config) => {
        options = config.options;
        return ["files", "workflows"];
      },
      logger: (line) => logs.push(line)
    });

    expect(options.map((option) => option.value)).toEqual(["rules", "files", "skills", "workflows"]);
    expect(options.every((option) => option.selected)).toBe(true);
    expect(saved.sections).toEqual({
      rules: false,
      files: true,
      skills: false,
      workflows: true
    });
    expect(loadOutputConfig({ dataRoot })).toEqual(saved);
    expect(fs.existsSync(outputConfigPath(dataRoot))).toBe(true);
    expect(logs).toEqual([
      `│  Saved ContextOS prompt section config: ${outputConfigPath(dataRoot)}`,
      "│  Enabled sections: files, workflows"
    ]);
  });

  it("fills missing config keys with enabled defaults", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-output-config-defaults-"));
    saveOutputConfig({ sections: { files: false } }, { dataRoot });

    expect(loadOutputConfig({ dataRoot }).sections).toEqual({
      rules: true,
      files: false,
      skills: true,
      workflows: true
    });
  });

  it("summarizes enabled output sections", () => {
    const config = {
      sections: {
        rules: false,
        files: true,
        skills: true,
        workflows: false
      }
    };

    expect(enabledOutputSections(config)).toEqual(["files", "skills"]);
    expect(enabledOutputSectionsLabel(config)).toBe("files, skills");
    expect(enabledOutputSectionsLabel({ sections: { rules: false, files: false, skills: false, workflows: false } })).toBe("(none)");
  });
});
