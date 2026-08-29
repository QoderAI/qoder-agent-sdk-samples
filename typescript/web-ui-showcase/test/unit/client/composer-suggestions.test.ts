import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  filterCommandSuggestions,
  parseSuggestionQuery,
  resolveCompletedCommand,
  type ActiveSuggestionQuery,
  type ComposerSuggestion,
} from "../../../src/client/features/conversation/composer-suggestions.js";

describe("Composer suggestions", () => {
  it("recognizes only active Slash command and file tokens", () => {
    expect(parseSuggestionQuery("/fix", 4)).toEqual({
      kind: "command",
      start: 0,
      end: 4,
      query: "fix",
    });
    expect(parseSuggestionQuery("  /fix", 6)).toEqual({
      kind: "command",
      start: 2,
      end: 6,
      query: "fix",
    });
    expect(parseSuggestionQuery("text /fix", 9)).toBeNull();
    expect(parseSuggestionQuery("/fix ", 5)).toBeNull();
    expect(parseSuggestionQuery("/model ", 7)).toBeNull();
    expect(parseSuggestionQuery("/model fixture", 14)).toBeNull();
    expect(parseSuggestionQuery("/model fixture extra", 20)).toBeNull();
    expect(parseSuggestionQuery("/fix\n@src", 9)).toEqual({
      kind: "file",
      start: 5,
      end: 9,
      query: "src",
      quoted: false,
    });
    expect(parseSuggestionQuery("open @src/app", 13)).toEqual({
      kind: "file",
      start: 5,
      end: 13,
      query: "src/app",
      quoted: false,
    });
    expect(parseSuggestionQuery('open @"docs/my f', 16)).toEqual({
      kind: "file",
      start: 5,
      end: 16,
      query: "docs/my f",
      quoted: true,
    });
    expect(parseSuggestionQuery('open @"docs/my file.md" ', 24)).toBeNull();
    expect(parseSuggestionQuery("email@example.com", 17)).toBeNull();
    expect(parseSuggestionQuery("/", 1)?.query).toBe("");
    expect(parseSuggestionQuery("open @", 6)?.query).toBe("");
  });

  it("filters command names by prefix and sorts them", () => {
    expect(
      filterCommandSuggestions(
        [
          {
            name: "fixture-run",
            description: "Run",
            argumentHint: "",
            execution: "sdk-input",
          },
          {
            name: "fixture-inspect",
            description: "Inspect",
            argumentHint: "[path]",
            execution: "sdk-input",
          },
          {
            name: "context",
            description: "Context",
            argumentHint: "",
            execution: "context-control",
          },
        ],
        "FIX",
      ),
    ).toEqual([
      {
        kind: "command",
        id: "command:fixture-inspect",
        command: {
          name: "fixture-inspect",
          description: "Inspect",
          argumentHint: "[path]",
          execution: "sdk-input",
        },
      },
      {
        kind: "command",
        id: "command:fixture-run",
        command: {
          name: "fixture-run",
          description: "Run",
          argumentHint: "",
          execution: "sdk-input",
        },
      },
    ]);
  });

  it("replaces only the active token and returns the next caret", () => {
    const commandQuery: ActiveSuggestionQuery = {
      kind: "command",
      start: 0,
      end: 3,
      query: "fi",
    };
    const command: ComposerSuggestion = {
      kind: "command",
      id: "command:fixture-inspect",
      command: {
        name: "fixture-inspect",
        description: "Inspect",
        argumentHint: "[path]",
        execution: "sdk-input",
      },
    };
    expect(applySuggestion("/fi now", 3, commandQuery, command)).toEqual({
      text: "/fixture-inspect  now",
      cursor: 17,
    });

    const noArgumentCommand: ComposerSuggestion = {
      id: "command:help",
      kind: "command",
      command: {
        name: "help",
        description: "Help",
        argumentHint: "",
        execution: "sdk-input",
      },
    };
    expect(applySuggestion("/he", 3, commandQuery, noArgumentCommand)).toEqual({
      text: "/help",
      cursor: 5,
    });

    const fileQuery: ActiveSuggestionQuery = {
      kind: "file",
      start: 5,
      end: 13,
      query: "docs/my",
      quoted: false,
    };
    expect(
      applySuggestion("read @docs/my", 13, fileQuery, {
        kind: "file",
        id: "file:docs/my file.md",
        path: "docs/my file.md",
        mention: "docs/my file.md",
        rootLabel: "repo",
        source: "workspace",
      }),
    ).toEqual({
      text: 'read @"docs/my file.md" ',
      cursor: 24,
    });
    expect(
      applySuggestion("read @src/ap later", 12, {
        ...fileQuery,
        start: 5,
        end: 12,
        query: "src/ap",
      }, {
        kind: "file",
        id: "file:src/app.ts",
        path: "src/app.ts",
        mention: "src/app.ts",
        rootLabel: "repo",
        source: "workspace",
      }),
    ).toEqual({
      text: "read @src/app.ts  later",
      cursor: 17,
    });
  });

  it("resolves only completed commands from the executable catalog", () => {
    const commands = [
      {
        name: "fixture-inspect",
        description: "Inspect",
        argumentHint: "[path]",
        execution: "sdk-input" as const,
      },
      {
        name: "model",
        description: "Model",
        argumentHint: "<model>",
        execution: "model-control" as const,
      },
    ];

    expect(resolveCompletedCommand("/model fixture-model", commands)).toEqual({
      command: commands[1],
      argument: "fixture-model",
    });
    expect(resolveCompletedCommand("/fixture-inspect src", commands)).toEqual({
      command: commands[0],
      argument: "src",
    });
    expect(resolveCompletedCommand("/unsupported", commands)).toBeUndefined();
  });
});
