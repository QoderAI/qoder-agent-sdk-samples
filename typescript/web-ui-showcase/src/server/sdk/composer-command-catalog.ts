import {
  composerCommandViewSchema,
  type ComposerCommandView,
} from "../../shared/model.js";

type CatalogCommand = {
  name: string;
  description?: string;
  argumentHint?: string;
};

type CatalogSkill = {
  name: string;
  description?: string;
};

const sdkInputCommands = new Set(["compact", "compress", "summarize"]);

const webUiControls: ComposerCommandView[] = [
  {
    name: "context",
    description: "刷新当前 Session 的 Context 使用情况。",
    argumentHint: "",
    execution: "context-control",
  },
  {
    name: "model",
    description: "选择当前 Session 使用的 Model。",
    argumentHint: "",
    execution: "model-control",
  },
  {
    name: "mcp",
    description: "管理当前 Session 的 MCP Server。",
    argumentHint: "",
    execution: "mcp-control",
  },
  {
    name: "permissions",
    description: "选择当前 Session 的 Permission Mode。",
    argumentHint: "",
    execution: "permission-control",
  },
];

/** Builds the subset of discovered commands that the browser can execute. */
export function buildComposerCommandCatalog(input: {
  commands?: readonly CatalogCommand[];
  skills?: readonly CatalogSkill[];
}): ComposerCommandView[] {
  const discovered = new Map<string, CatalogCommand>();
  for (const command of input.commands ?? []) {
    if (!discovered.has(command.name)) discovered.set(command.name, command);
  }

  const executable = new Map<string, ComposerCommandView>();
  for (const command of webUiControls) executable.set(command.name, command);

  for (const name of sdkInputCommands) {
    const command = discovered.get(name);
    if (command === undefined) continue;
    executable.set(name, {
      name,
      description: command.description ?? "",
      argumentHint: command.argumentHint ?? "",
      execution: "sdk-input",
    });
  }

  for (const skill of input.skills ?? []) {
    const leafName = skill.name.split(":").at(-1) ?? skill.name;
    const command = discovered.get(skill.name) ?? discovered.get(leafName);
    const name = command?.name ?? skill.name;
    if (executable.has(name)) continue;
    executable.set(name, {
      name,
      description:
        command?.description && command.description.length > 0
          ? command.description
          : (skill.description ?? ""),
      argumentHint: command?.argumentHint ?? "",
      execution: "sdk-input",
    });
  }

  return [...executable.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => composerCommandViewSchema.parse(command));
}
