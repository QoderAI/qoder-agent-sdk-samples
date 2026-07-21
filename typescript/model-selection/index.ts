import { pathToFileURL } from "node:url";
import * as readline from "node:readline/promises";

import {
  accessTokenFromEnv,
  query,
  type ModelInfo,
  type ModelPolicyProvider,
  type ModelPolicyResult,
  type SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

type Selection = {
  model: ModelInfo;
  contextWindow?: number;
  reasoningEffort?: string;
};

class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiter?: (message: SDKUserMessage | null) => void;
  private ended = false;

  push(text: string): void {
    if (this.ended) throw new Error("The query input is closed.");
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
    if (this.waiter) {
      const resolveNext = this.waiter;
      this.waiter = undefined;
      resolveNext(message);
    } else {
      this.buffered.push(message);
    }
  }

  end(): void {
    this.ended = true;
    this.waiter?.(null);
    this.waiter = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const buffered = this.buffered.shift();
      if (buffered) {
        yield buffered;
        continue;
      }
      if (this.ended) return;
      const message = await new Promise<SDKUserMessage | null>((resolveNext) => {
        this.waiter = resolveNext;
      });
      if (!message) return;
      yield message;
    }
  }
}

function contextWindows(model: ModelInfo): number[] {
  const direct = model.availableContextWindows ?? [];
  const configured = Object.values(model.context_config ?? {}).map(
    (entry) => entry.token_count,
  );
  return [...new Set([...direct, ...configured])].sort((left, right) => left - right);
}

function defaultContextWindow(model: ModelInfo): number | undefined {
  if (model.defaultContextWindow) return model.defaultContextWindow;
  return Object.values(model.context_config ?? {}).find((entry) => entry.is_default)
    ?.token_count;
}

function reasoningEfforts(model: ModelInfo): string[] {
  const configured = Object.keys(model.thinking_config?.enabled?.efforts ?? {});
  return [...new Set([...(model.efforts ?? []), ...configured])];
}

function defaultReasoningEffort(model: ModelInfo): string | undefined {
  if (model.defaultEffort) return model.defaultEffort;
  const efforts = model.thinking_config?.enabled?.efforts ?? {};
  return Object.entries(efforts).find(([, entry]) => entry.is_default)?.[0];
}

function describeModel(model: ModelInfo): string {
  const windows = contextWindows(model);
  const efforts = reasoningEfforts(model);
  const details = [
    windows.length ? `context=${windows.map((value) => value.toLocaleString()).join("/")}` : "context=default",
    efforts.length ? `reasoning=${efforts.join("/")}` : "reasoning=default",
  ];
  return `${model.displayName || model.value} (${model.value}) — ${details.join(", ")}`;
}

async function chooseIndex(
  terminal: readline.Interface,
  label: string,
  values: string[],
  defaultIndex: number,
): Promise<number> {
  while (true) {
    const raw = (await terminal.question(`${label} [${defaultIndex + 1}]: `)).trim();
    if (!raw) return defaultIndex;
    const index = Number(raw) - 1;
    if (Number.isInteger(index) && index >= 0 && index < values.length) {
      return index;
    }
    const byValue = values.findIndex(
      (value) => value.toLowerCase() === raw.toLowerCase(),
    );
    if (byValue >= 0) return byValue;
    console.log("Invalid selection; enter a listed number or value.");
  }
}

async function chooseModel(
  terminal: readline.Interface,
  models: ModelInfo[],
): Promise<Selection> {
  const enabled = models.filter((model) => model.isEnabled !== false);
  if (enabled.length === 0) throw new Error("No enabled models are available.");

  console.log("Available models:\n");
  enabled.forEach((model, index) => {
    const marker = model.isDefault ? " [default]" : "";
    console.log(`${index + 1}. ${describeModel(model)}${marker}`);
  });

  const defaultModelIndex = Math.max(
    0,
    enabled.findIndex((model) => model.isDefault || model.value === "auto"),
  );
  const modelIndex = await chooseIndex(
    terminal,
    "Choose model",
    enabled.map((model) => model.value),
    defaultModelIndex,
  );
  const model = enabled[modelIndex];
  const windows = contextWindows(model);
  let contextWindow: number | undefined;
  if (windows.length) {
    console.log(`\nContext windows: ${windows.map((value, index) => `${index + 1}. ${value.toLocaleString()}`).join("  ")}`);
    const configuredDefault = defaultContextWindow(model);
    const defaultIndex = Math.max(0, windows.indexOf(configuredDefault ?? windows[0]));
    contextWindow = windows[
      await chooseIndex(
        terminal,
        "Choose context window",
        windows.map(String),
        defaultIndex,
      )
    ];
  }

  const efforts = reasoningEfforts(model);
  let reasoningEffort: string | undefined;
  if (efforts.length) {
    console.log(`\nReasoning efforts: ${efforts.map((value, index) => `${index + 1}. ${value}`).join("  ")}`);
    const configuredDefault = defaultReasoningEffort(model);
    const defaultIndex = Math.max(0, efforts.indexOf(configuredDefault ?? efforts[0]));
    reasoningEffort = efforts[
      await chooseIndex(terminal, "Choose reasoning effort", efforts, defaultIndex)
    ];
  }

  return { model, contextWindow, reasoningEffort };
}

async function loadModels(): Promise<ModelInfo[]> {
  const input = new MessageQueue();
  const catalogQuery = query({
    prompt: input,
    options: { auth: accessTokenFromEnv(), model: "auto" },
  });
  try {
    await catalogQuery.initializationResult();
    return await catalogQuery.getAvailableModels();
  } finally {
    input.end();
    await catalogQuery.close();
  }
}

function policyResult(selection: Selection): ModelPolicyResult {
  const parameters: Record<string, unknown> = {};
  if (selection.contextWindow) parameters.contextWindow = selection.contextWindow;
  if (selection.reasoningEffort) {
    parameters.reasoningEffort = selection.reasoningEffort;
  }
  return {
    model: selection.model.value,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  };
}

export async function run(prompt: string): Promise<void> {
  const models = await loadModels();
  if (models.length === 0) throw new Error("The model catalog is temporarily empty.");
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const selection = await chooseModel(terminal, models);
    const selectedPolicy = policyResult(selection);

    console.log(`\nSelected model: ${selection.model.value}`);
    console.log(`Context window: ${selection.contextWindow?.toLocaleString() ?? "model default"}`);
    console.log(`Reasoning effort: ${selection.reasoningEffort ?? "model default"}\n`);

    const resolveModel: ModelPolicyProvider = (context) => {
      const available = new Set(context.availableModels.map((model) => model.value));
      if (available.size && !available.has(selection.model.value)) {
        throw new Error(`Model ${selection.model.value} is no longer available.`);
      }
      console.log(`[model-policy] purpose=${context.purpose} model=${selection.model.value}`);
      return selectedPolicy;
    };

    const executionQuery = query({
      prompt,
      options: {
        auth: accessTokenFromEnv(),
        resolveModel,
        resolveModelTimeoutMs: 1_000,
        tools: [],
        maxTurns: 1,
      },
    });
    let completed = false;
    try {
      for await (const message of executionQuery) {
        if (message.type !== "result") continue;
        if (message.subtype !== "success") {
          throw new Error(message.errors?.join("\n") || message.subtype);
        }
        console.log(`\nassistant> ${message.result}`);
        completed = true;
      }
    } finally {
      await executionQuery.close();
    }
    if (!completed) throw new Error("The query ended without a success result.");
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  const prompt =
    process.argv.slice(2).join(" ") ||
    "Explain in one sentence why applications should select models from runtime metadata.";
  await run(prompt);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
