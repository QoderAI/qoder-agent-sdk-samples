# Qoder Agent SDK Samples

本仓库提供面向实际开发者的 Qoder Agent SDK 示例。每个场景同时提供
TypeScript 和 Python 实现。

## 示例列表

| 示例 | 展示内容 | TypeScript | Python |
| --- | --- | --- | --- |
| Quickstart | 发起一次理解代码仓库的查询并处理结果 | [查看](typescript/quickstart) | [查看](python/quickstart) |
| Multi-turn conversation | 控制 query 生命周期并在关闭后恢复上下文 | [查看](typescript/multi-turn-conversation) | [查看](python/multi-turn-conversation) |
| Streaming chat | 在一个持续连接的会话中进行流式输出 | [查看](typescript/streaming-chat) | [查看](python/streaming-chat) |
| Code review | 使用只读仓库工具审查 Git diff | [查看](typescript/code-review) | [查看](python/code-review) |
| Tool permissions | 区分工具可见性、预授权和运行时授权 | [查看](typescript/tool-permissions) | [查看](python/tool-permissions) |
| Ask user question | 渲染结构化问题并将用户回答返回给 Agent | [查看](typescript/ask-user-question) | [查看](python/ask-user-question) |
| Model selection | 列出模型并选择上下文窗口和推理参数 | [查看](typescript/model-selection) | [查看](python/model-selection) |
| Hooks | 添加生命周期观测、上下文注入和工具策略 | [查看](typescript/hooks) | [查看](python/hooks) |
| Custom tools | 将应用函数注册为进程内 MCP 工具 | [查看](typescript/custom-tools) | [查看](python/custom-tools) |
| Subagents | 将任务委派给 SDK 定义的专业子 Agent | [查看](typescript/subagents) | [查看](python/subagents) |

## 准备工作

这些示例从环境变量读取 Personal Access Token。认证配置和其他可用认证方式见
[SDK 认证文档](https://docs.qoder.com/en/cli/sdk/authentication)。

```bash
export QODER_PERSONAL_ACCESS_TOKEN="<your-token>"
```

完整 API 指南见 [Qoder Agent SDK 文档](https://docs.qoder.com/en/cli/sdk)。
TypeScript 需要 Node.js 18 或更高版本，Python 需要 Python 3.10 或更高版本。

每个示例都是独立项目，具体安装和运行方式见对应目录的 README。

## 兼容性

各示例的依赖清单声明了兼容的 SDK 版本范围，仓库锁文件则记录了 CI 使用的确切版本。

最近一次验证时间：2026 年 7 月 20 日：

- TypeScript SDK 1.0.15
- Python SDK 1.0.9

## 许可与条款

示例源代码基于 [MIT 许可证](LICENSE)授权。Qoder Agent SDK 及 Qoder 服务的使用受
[Qoder 产品服务条款](https://qoder.com/product-service)约束。
