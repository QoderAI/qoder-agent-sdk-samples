# Qoder TypeScript Agent SDK 快速开始

本文只讲可以从 `@qoder-ai/qoder-agent-sdk` 公共导出直接使用的最小模式。它先给出一个单次 Query，再给出一个可以持续接收用户输入的长生命周期 Query；Web UI Showcase 在这些合同之上增加了 REST/WebSocket、状态投影、并发控制和浏览器安全边界。

示例按本项目当前安装的 `@qoder-ai/qoder-agent-sdk` 1.0.21 和 Node.js 22 编写。

## 准备项目

在新的 Node.js ESM 项目中安装 SDK。`zod` 是定义 SDK MCP Tool schema 时使用的 peer dependency：

```bash
npm install @qoder-ai/qoder-agent-sdk zod
```

示例使用本地安装的 `tsx` 运行，并使用 TypeScript 和 Node 类型做静态检查：

```bash
npm install --save-dev tsx typescript @types/node
```

`package.json` 至少包含：

```json
{
  "type": "module"
}
```

### 选择认证

- 本机已经通过 qodercli 登录：使用 `qodercliAuth()`。
- 由服务端环境提供 personal access token：设置 `QODER_PERSONAL_ACCESS_TOKEN`，使用 `accessTokenFromEnv()`。

```ts
import {
  accessTokenFromEnv,
  qodercliAuth,
} from "@qoder-ai/qoder-agent-sdk";

const auth = process.env.QODER_PERSONAL_ACCESS_TOKEN
  ? accessTokenFromEnv()
  : qodercliAuth();
```

认证对象、token、SDK Query 和回调都应留在受信任的 Node.js 进程。不要把它们放到浏览器 bundle、REST response、localStorage 或客户端日志。

## 单次 Query

预计用时：5 分钟。

创建 `one-shot.ts`：

```ts
import { qodercliAuth, query } from "@qoder-ai/qoder-agent-sdk";

const prompt =
  process.argv.slice(2).join(" ") || "用三点说明这个项目的主要目录。";

const q = query({
  prompt,
  options: {
    auth: qodercliAuth(),
    cwd: process.cwd(),
  },
});

try {
  for await (const message of q) {
    if (message.type !== "assistant") continue;

    for (const block of message.message.content) {
      if (block.type === "text" && block.text !== undefined) {
        process.stdout.write(block.text);
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await q.close();
}
```

运行：

```bash
npx tsx one-shot.ts "只读取当前目录并概括 package.json 的用途。"
```

这个例子有五个不可省略的边界：

1. `query()` 是 Query 的创建入口。
2. `auth` 和 `cwd` 由服务端决定；`cwd` 是 Agent 可以工作的项目根目录。
3. `Query` 是 `AsyncIterable<SDKMessage>`，必须使用 `for await` 消费消息。
4. 不要把每种 SDK 消息都当作最终 Assistant 文本；这里显式筛选 `assistant` 和 `text` block。
5. 无论正常完成还是异常退出，都在 `finally` 中 `await q.close()`。

如需 token 认证，只替换 import 和 `auth`：

```ts
import {
  accessTokenFromEnv,
  query,
} from "@qoder-ai/qoder-agent-sdk";

const q = query({
  prompt: "检查当前项目。",
  options: {
    auth: accessTokenFromEnv(),
    cwd: process.cwd(),
  },
});
```

`accessTokenFromEnv()` 读取服务端环境。不要把 token 作为 prompt、浏览器字段或日志内容传入。

## 长生命周期交互 Query

预计用时：15 分钟。

聊天、WebSocket 或队列消费者不能把每条用户消息都变成一个新的 Query。应创建一个 `AsyncIterable<SDKUserMessage>`，持续向同一个 Query 输入消息，同时在另一条异步任务中持续消费 SDK 输出。

下面的 `interactive.ts` 是完整的终端示例。它的队列只支持一个 SDK consumer，足以展示 Web 服务需要实现的核心合同：

```ts
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  qodercliAuth,
  query,
  type SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

type Priority = NonNullable<SDKUserMessage["priority"]>;

class InputQueue implements AsyncIterable<SDKUserMessage> {
  readonly #items: SDKUserMessage[] = [];
  #wake: (() => void) | undefined;
  #closed = false;

  push(message: SDKUserMessage): void {
    if (this.#closed) throw new Error("InputQueue is closed.");
    this.#items.push(message);
    this.#notify();
  }

  cancel(uuid: string): boolean {
    const index = this.#items.findIndex((message) => message.uuid === uuid);
    if (index === -1) return false;
    this.#items.splice(index, 1);
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#notify();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const message = this.#items.shift();
      if (message !== undefined) {
        yield message;
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}

function userMessage(
  text: string,
  options: { priority?: Priority; shouldQuery?: boolean } = {},
): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    priority: options.priority ?? "next",
    shouldQuery: options.shouldQuery ?? true,
  };
}

function parseInput(line: string): {
  text: string;
  priority: Priority;
  shouldQuery: boolean;
} {
  if (line.startsWith("/now ")) {
    return { text: line.slice(5), priority: "now", shouldQuery: true };
  }
  if (line.startsWith("/later ")) {
    return { text: line.slice(7), priority: "later", shouldQuery: true };
  }
  if (line.startsWith("/note ")) {
    return { text: line.slice(6), priority: "next", shouldQuery: false };
  }
  return { text: line, priority: "next", shouldQuery: true };
}

const input = new InputQueue();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const q = query({
  prompt: input,
  options: {
    auth: qodercliAuth(),
    cwd: process.cwd(),
  },
});

let lastUuid: string | undefined;
let outputError: unknown;
const outputTask = (async () => {
  try {
    for await (const message of q) {
      if (
        message.type === "system" &&
        message.subtype === "session_state_changed"
      ) {
        console.error(`\n[Session: ${message.state}]`);
      }
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text" && block.text !== undefined) {
          process.stdout.write(block.text);
        }
      }
    }
  } catch (error) {
    outputError = error;
    terminal.close();
  }
})();

try {
  console.log("输入消息；/now、/later、/note 可改变下一条消息的语义。");
  console.log("/interrupt 中断当前 turn，/cancel 取消上一条消息，/exit 退出。\n");

  for await (const rawLine of terminal) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line === "/exit") break;

    if (line === "/interrupt") {
      console.dir(await q.interrupt(), { depth: null });
      continue;
    }

    if (line === "/cancel") {
      if (lastUuid === undefined) {
        console.error("没有可取消的消息。");
        continue;
      }
      const cancelledLocally = input.cancel(lastUuid);
      const cancelled =
        cancelledLocally || (await q.cancelAsyncMessage(lastUuid));
      console.error(cancelled ? "消息已取消。" : "消息已无法取消。");
      if (cancelled) lastUuid = undefined;
      continue;
    }

    const parsed = parseInput(line);
    if (parsed.text.trim().length === 0) continue;
    const message = userMessage(parsed.text, parsed);
    lastUuid = message.uuid;
    input.push(message);
  }
} finally {
  terminal.close();
  input.close();
  await q.close();
  await outputTask;
}

if (outputError !== undefined) throw outputError;
```

运行：

```bash
npx tsx interactive.ts
```

可以输入：

```text
总结当前项目，只读取文件。
/later 等当前回复结束后，只回复 LATER_OK。
/now 立即停止当前回复，只回复 NOW_OK。
/note 这是写入对话但不自行触发模型 turn 的说明。
/cancel
/interrupt
/exit
```

### `priority` 与 `shouldQuery`

| 字段 | 语义 |
| --- | --- |
| `priority: "now"` | 中断活跃回复并尽快处理该输入 |
| `priority: "next"` | 默认值；在下一个合适的安全点处理 |
| `priority: "later"` | 等当前回复结束并进入可处理状态 |
| `shouldQuery: false` | 把消息加入对话，但不由该消息自行启动模型 turn；交付时点仍服从 `priority` |

每个可追踪或可取消的异步消息都应使用 Session 内不重复的 `uuid`。上例先尝试从应用本地队列取消；如果消息已经被 `AsyncIterable` yield 给 SDK，再调用 `cancelAsyncMessage(uuid)`。

### 不要虚构“一条输入对应一个 result”

- 应用队列把消息 yield 给 SDK，只能证明输入已交付到 SDK transport，不能证明一个 turn 已完成。
- SDK 可以合并多条异步输入；result 消息也不携带唯一的来源输入 UUID。
- `cancelAsyncMessage(uuid)` 返回 `true` 表示队列消息被取消；返回 `false` 表示已经无法取消，不等于 Session 失败。
- `interrupt()` 只中断当前工作，不关闭 Query。应根据 receipt 中的 `still_queued` 和可选 `cancelled` UUID 协调应用队列。
- 如果运行时提供 `session_state_changed`，`idle`、`running`、`requires_action` 才是 Session 生命周期的主要证据；不要只凭任意 result 清空全部输入或强制设为 idle。

Showcase 对应实现位于 [`input-queue.ts`](../src/server/sdk/input-queue.ts) 和 [`session-controller.ts`](../src/server/sdk/session-controller.ts)。产品 Composer 默认使用 `next` / `true`，但应用 port 保留完整字段。

## 新建、恢复与 Fork Session

Query 创建时只选择一种意图：

```ts
const created = query({
  prompt: input,
  options: {
    auth,
    cwd,
    sessionId: crypto.randomUUID(),
  },
});

const resumed = query({
  prompt: input,
  options: {
    auth,
    cwd,
    resume: existingSessionId,
  },
});

const forked = query({
  prompt: input,
  options: {
    auth,
    cwd,
    resume: existingSessionId,
    forkSession: true,
  },
});
```

- `sessionId` 让 host 为新 Session 指定标识。
- `resume` 恢复已有 Session；host 应确保 `cwd` 和 Session 所属 Workspace 一致。
- `forkSession: true` 与 `resume` 一起使用，从已有历史创建新分支，不应覆盖原 Session。
- 每个 Query 都有独立生命周期。当 host 不再保留某个 Query，例如关闭、重启或删除 Session，或者采用单活 Session 策略并切换目标时，应先停止接收新命令，再 `await q.close()`；不要在 fatal transport/output 后继续复用旧 Query。

## 回调与浏览器边界

完整 Web 产品通常还需要：

- `canUseTool`：把 SDK 的权限 Promise 映射为产品 Approval，并响应 SDK abort signal。
- `onElicitation`：把 MCP form/URL 请求映射为结构化产品交互。
- `hooks`：做观测、策略或上下文注入，不要把 Hook payload 原样发到浏览器。
- `mcpServers`：远程 headers、子进程环境和 OAuth token 只由服务端持有；授权 URL 可以按产品策略显示给用户，用户提交的 callback URL 只用于一次服务端控制请求，不应写入持久客户端状态或诊断事件。
- `includePartialMessages`：将增量输出投影为稳定语义项，而不是把每个 delta 追加成新消息。

这些选项在 Showcase 的唯一 Query 创建点 [`query-factory.ts`](../src/server/sdk/query-factory.ts) 统一组合。其片段依赖应用自己的 `InputQueue`、`InteractionBroker`、配置和 MCP/Hook 注册，不是可以脱离项目复制的 Quick Start。

## SDK 合同与 Showcase 额外工作

| 内容 | SDK 公共合同 | Showcase 负责 |
| --- | --- | --- |
| Query 生命周期 | `query()`、异步消息迭代、`close()` | registry、自动 availability、失败重建、graceful shutdown |
| 输入 | `AsyncIterable<SDKUserMessage>`、priority、`shouldQuery`、cancel/interrupt | 本地队列状态、命令关联、保守批次协调、界面提示 |
| Session | `sessionId`、`resume`、`forkSession` 和 catalog API | Workspace 绑定、并发去重、snapshot/history 一致性 |
| 浏览器 | SDK 返回消息和回调 | Zod wire model、语义投影、脱敏、大小预算、REST/WebSocket 恢复 |
| Checkpoint | `rewindFiles()`、`rewind()` | dry-run UI、revision 绑定、单次预览、mutation fence、权威历史替换 |

下一步阅读 [SDK 代码导览](SDK_CODE_TOUR.md#一条消息如何穿过系统)，沿一条浏览器消息追踪到 `query()`、SDK message stream 和客户端 reducer；要验证产品表现则使用[产品试用手册](PRODUCT_TRIAL_GUIDE.md)。
