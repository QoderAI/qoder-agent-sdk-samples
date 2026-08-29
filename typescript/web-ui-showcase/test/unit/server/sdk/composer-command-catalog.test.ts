import { describe, expect, it } from "vitest";
import { buildComposerCommandCatalog } from "../../../../src/server/sdk/composer-command-catalog.js";

describe("buildComposerCommandCatalog", () => {
  it("keeps only SDK input and Web UI control commands that can execute", () => {
    const result = buildComposerCommandCatalog({
      commands: [
        {
          name: "compact",
          description: "Compact this Session.",
          argumentHint: "",
        },
        {
          name: "compress",
          description: "Alias for compact.",
          argumentHint: "",
        },
        {
          name: "summarize",
          description: "Alias for compact.",
          argumentHint: "",
        },
        {
          name: "model",
          description: "Open the qodercli Model dialog.",
          argumentHint: "",
        },
        {
          name: "fixture-inspect",
          description: "Inspect the deterministic fixture.",
          argumentHint: "[path]",
        },
        {
          name: "unsupported-dialog",
          description: "Opens an interactive qodercli dialog.",
          argumentHint: "",
        },
      ],
      skills: [
        {
          name: "fixture-inspect",
          description: "Skill fallback that must not replace command copy.",
        },
      ],
    });

    expect(result).toEqual([
      {
        name: "compact",
        description: "Compact this Session.",
        argumentHint: "",
        execution: "sdk-input",
      },
      {
        name: "compress",
        description: "Alias for compact.",
        argumentHint: "",
        execution: "sdk-input",
      },
      {
        name: "context",
        description: "刷新当前 Session 的 Context 使用情况。",
        argumentHint: "",
        execution: "context-control",
      },
      {
        name: "fixture-inspect",
        description: "Inspect the deterministic fixture.",
        argumentHint: "[path]",
        execution: "sdk-input",
      },
      {
        name: "mcp",
        description: "管理当前 Session 的 MCP Server。",
        argumentHint: "",
        execution: "mcp-control",
      },
      {
        name: "model",
        description: "选择当前 Session 使用的 Model。",
        argumentHint: "",
        execution: "model-control",
      },
      {
        name: "permissions",
        description: "选择当前 Session 的 Permission Mode。",
        argumentHint: "",
        execution: "permission-control",
      },
      {
        name: "summarize",
        description: "Alias for compact.",
        argumentHint: "",
        execution: "sdk-input",
      },
    ]);
  });

  it("uses the executable command metadata for namespaced Skills and deduplicates names", () => {
    expect(
      buildComposerCommandCatalog({
        commands: [
          {
            name: "review",
            description: "Review the selected project.",
            argumentHint: "[path]",
          },
          {
            name: "review",
            description: "Duplicate metadata.",
            argumentHint: "",
          },
        ],
        skills: [
          { name: "plugin:review", description: "Namespaced review Skill." },
          { name: "standalone-skill", description: "Standalone Skill." },
        ],
      }),
    ).toEqual([
      {
        name: "context",
        description: "刷新当前 Session 的 Context 使用情况。",
        argumentHint: "",
        execution: "context-control",
      },
      {
        name: "mcp",
        description: "管理当前 Session 的 MCP Server。",
        argumentHint: "",
        execution: "mcp-control",
      },
      {
        name: "model",
        description: "选择当前 Session 使用的 Model。",
        argumentHint: "",
        execution: "model-control",
      },
      {
        name: "permissions",
        description: "选择当前 Session 的 Permission Mode。",
        argumentHint: "",
        execution: "permission-control",
      },
      {
        name: "review",
        description: "Review the selected project.",
        argumentHint: "[path]",
        execution: "sdk-input",
      },
      {
        name: "standalone-skill",
        description: "Standalone Skill.",
        argumentHint: "",
        execution: "sdk-input",
      },
    ]);
  });
});
