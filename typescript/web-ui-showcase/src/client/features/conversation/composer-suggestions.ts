import type { ComposerCommandView } from "../../../shared/model.js";
import type { WorkspaceFileItem } from "../../../shared/workspace-files.js";

export type ActiveSuggestionQuery =
  | { kind: "command"; start: number; end: number; query: string }
  | {
      kind: "file";
      start: number;
      end: number;
      query: string;
      quoted: boolean;
    };

export type ComposerSuggestion =
  | { kind: "command"; id: string; command: ComposerCommandView }
  | ({ kind: "file"; id: string } & WorkspaceFileItem);

export type ModelOption = { value: string; label: string };

/** Returns distinct, non-empty suggestions in SDK order. */
export function normalizePromptSuggestions(
  suggestions: readonly string[],
): string[] {
  const normalized = new Set<string>();
  for (const suggestion of suggestions) {
    for (const line of suggestion.split(/\r?\n/u)) {
      const value = line.trim();
      if (value.length > 0) normalized.add(value);
    }
  }
  return [...normalized];
}

export function parseSuggestionQuery(
  text: string,
  cursor: number,
): ActiveSuggestionQuery | null {
  if (cursor < 0 || cursor > text.length) return null;
  const prefix = text.slice(0, cursor);
  const firstNonWhitespace = text.search(/\S/u);
  if (
    firstNonWhitespace >= 0 &&
    firstNonWhitespace < cursor &&
    text[firstNonWhitespace] === "/"
  ) {
    const commandToken = text.slice(firstNonWhitespace + 1, cursor);
    if (!/\s/u.test(commandToken)) {
      return {
        kind: "command",
        start: firstNonWhitespace,
        end: cursor,
        query: commandToken,
      };
    }
  }

  let quotedStart = prefix.lastIndexOf('@"');
  while (quotedStart >= 0) {
    const startsToken =
      quotedStart === 0 || /\s/u.test(prefix[quotedStart - 1] ?? "");
    const quotedQuery = prefix.slice(quotedStart + 2);
    if (startsToken && !quotedQuery.includes('"')) {
      return {
        kind: "file",
        start: quotedStart,
        end: cursor,
        query: quotedQuery,
        quoted: true,
      };
    }
    quotedStart = prefix.lastIndexOf('@"', quotedStart - 1);
  }

  let tokenStart = cursor;
  while (tokenStart > 0 && !/\s/u.test(text[tokenStart - 1] ?? "")) {
    tokenStart -= 1;
  }
  const token = text.slice(tokenStart, cursor);
  if (!token.startsWith("@") || token.includes('"')) return null;
  return {
    kind: "file",
    start: tokenStart,
    end: cursor,
    query: token.slice(1),
    quoted: false,
  };
}

export function filterCommandSuggestions(
  commands: ComposerCommandView[],
  query: string,
): ComposerSuggestion[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return commands
    .filter((command) =>
      command.name.toLocaleLowerCase().startsWith(normalizedQuery),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => ({
      kind: "command" as const,
      id: `command:${command.name}`,
      command,
    }));
}

export function readModelOptions(
  models: readonly Record<string, unknown>[],
): ModelOption[] {
  const options = new Map<string, ModelOption>();
  for (const model of models) {
    const value = ["value", "id", "model", "name"]
      .map((key) => model[key])
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.length > 0,
      );
    if (value === undefined || options.has(value)) continue;
    const label = ["displayName", "name", "label", "id", "model", "value"]
      .map((key) => model[key])
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.length > 0,
      );
    options.set(value, { value, label: label ?? value });
  }
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function resolveCompletedCommand(
  text: string,
  commands: readonly ComposerCommandView[],
): { command: ComposerCommandView; argument: string } | undefined {
  const match = /^\/([^\s]+)(?:\s+(.*))?$/u.exec(text.trim());
  if (match === null) return undefined;
  const command = commands.find((candidate) => candidate.name === match[1]);
  return command === undefined
    ? undefined
    : { command, argument: (match[2] ?? "").trim() };
}

export function applySuggestion(
  text: string,
  _cursor: number,
  query: ActiveSuggestionQuery,
  suggestion: ComposerSuggestion,
): { text: string; cursor: number } {
  let replacement: string;
  switch (suggestion.kind) {
    case "command":
      replacement = `/${suggestion.command.name}${
        suggestion.command.argumentHint.trim().length > 0 ? " " : ""
      }`;
      break;
    case "file":
      replacement = `${
        /\s/u.test(suggestion.mention)
          ? `@"${suggestion.mention}"`
          : `@${suggestion.mention}`
      } `;
      break;
  }
  return {
    text: `${text.slice(0, query.start)}${replacement}${text.slice(query.end)}`,
    cursor: query.start + replacement.length,
  };
}
