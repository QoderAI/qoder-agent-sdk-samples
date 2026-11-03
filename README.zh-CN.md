# Qoder Agent SDK Samples

本仓库提供面向实际开发者的 Qoder Agent SDK 示例，包含 TypeScript、Python 和 Java 实现；
各语言的覆盖范围见下表。

## 应用样板

| 样板 | 展示内容 | 语言 |
| --- | --- | --- |
| [Web UI showcase](typescript/web-ui-showcase) | 中文浅色界面的本地项目 Agent；连续流式消息聚合显示，审批位于主界面，并覆盖 Session、MCP、Hooks、Task、Credits、Checkpoint、错误、退出和恢复 | TypeScript |

## 示例列表

| 示例 | 展示内容 | TypeScript | Python | Java |
| --- | --- | --- | --- | --- |
| Quickstart | 发起一次理解代码仓库的查询并处理结果 | [查看](typescript/quickstart) | [查看](python/quickstart) | [查看](java/quickstart) |
| Multi-turn conversation | 控制 query 生命周期并在关闭后恢复上下文 | [查看](typescript/multi-turn-conversation) | [查看](python/multi-turn-conversation) | [查看](java/multi-turn-conversation) |
| Streaming chat | 在一个持续连接的会话中进行流式输出 | [查看](typescript/streaming-chat) | [查看](python/streaming-chat) | [查看](java/streaming-chat) |
| Code review | 使用只读仓库工具审查 Git diff | [查看](typescript/code-review) | [查看](python/code-review) | [查看](java/code-review) |
| Tool permissions | 区分工具可见性、预授权和运行时授权 | [查看](typescript/tool-permissions) | [查看](python/tool-permissions) | [查看](java/tool-permissions) |
| Ask user question | 渲染结构化问题并将用户回答返回给 Agent | [查看](typescript/ask-user-question) | [查看](python/ask-user-question) | — |
| Model selection | 列出模型并选择上下文窗口和推理参数 | [查看](typescript/model-selection) | [查看](python/model-selection) | [查看](java/model-selection) |
| Hooks | 添加生命周期观测、上下文注入和工具策略 | [查看](typescript/hooks) | [查看](python/hooks) | [查看](java/hooks) |
| Custom tools | 将应用函数注册为进程内 MCP 工具 | [查看](typescript/custom-tools) | [查看](python/custom-tools) | — |
| Subagents | 将任务委派给 SDK 定义的专业子 Agent | [查看](typescript/subagents) | [查看](python/subagents) | — |
| External session storage | 通过 Redis 或 PostgreSQL 在另一个运行实例上恢复会话 | [查看](typescript/external-session-storage) | [查看](python/external-session-storage) | — |

## 准备工作

除非示例 README 另有说明，否则示例从环境变量读取 Personal Access Token。认证
配置和其他可用认证方式见
[SDK 认证文档](https://docs.qoder.com/en/cli/sdk/authentication)。

```bash
export QODER_PERSONAL_ACCESS_TOKEN="<your-token>"
```

完整 API 指南见 [Qoder Agent SDK 文档](https://docs.qoder.com/en/cli/sdk)。
TypeScript 需要 Node.js 18 或更高版本，Python 需要 Python 3.10 或更高版本。
Java 构建需要 JDK 11 或更高版本（推荐 17）和 Maven 3.6.3 或更高版本，见 [Java 说明](java)。

每个示例都是独立项目，具体安装和运行方式见对应目录的 README。

## 兼容性

TypeScript/Python 依赖清单声明兼容的版本范围，锁文件记录 CI 使用的确切版本。
Java POM 固定使用 Maven Central 的 SDK 0.2.3，并以 `--release 8` 编译。

依赖版本（构建与真实运行验证分别记录）：

- TypeScript SDK 1.0.16
- Python SDK 1.0.10
- Java SDK 0.2.3

## 许可与条款

示例源代码基于 [MIT 许可证](LICENSE)授权。Qoder Agent SDK 及 Qoder 服务的使用受
[Qoder 产品服务条款](https://qoder.com/product-service)约束。
