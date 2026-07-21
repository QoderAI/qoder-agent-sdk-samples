# Qoder Agent SDK Samples

Runnable, focused examples for building applications with the Qoder Agent SDK.
Every sample is available in TypeScript and Python.

## Samples

| Sample | What it demonstrates | TypeScript | Python |
| --- | --- | --- | --- |
| Quickstart | Run one repository-aware query and handle the result | [Open](typescript/quickstart) | [Open](python/quickstart) |
| Multi-turn conversation | Control the query lifecycle and resume context after closing | [Open](typescript/multi-turn-conversation) | [Open](python/multi-turn-conversation) |
| Streaming chat | Stream output while keeping one live session open | [Open](typescript/streaming-chat) | [Open](python/streaming-chat) |
| Code review | Review a Git diff with read-only repository tools | [Open](typescript/code-review) | [Open](python/code-review) |
| Tool permissions | Separate tool visibility, pre-approval, and runtime authorization | [Open](typescript/tool-permissions) | [Open](python/tool-permissions) |
| Ask user question | Render structured questions and return user answers | [Open](typescript/ask-user-question) | [Open](python/ask-user-question) |
| Model selection | List models and select context-window and reasoning parameters | [Open](typescript/model-selection) | [Open](python/model-selection) |
| Hooks | Add lifecycle observation, context injection, and tool policy | [Open](typescript/hooks) | [Open](python/hooks) |
| Custom tools | Expose application functions as in-process MCP tools | [Open](typescript/custom-tools) | [Open](python/custom-tools) |
| Subagents | Delegate a task to specialized SDK-defined agents | [Open](typescript/subagents) | [Open](python/subagents) |

## Setup

These samples read a Personal Access Token from the environment. See
[SDK Authentication](https://docs.qoder.com/en/cli/sdk/authentication) for the
setup and other supported authentication methods.

```bash
export QODER_PERSONAL_ACCESS_TOKEN="<your-token>"
```

For the complete API guide, see the
[Qoder Agent SDK documentation](https://docs.qoder.com/en/cli/sdk).

## Prerequisites

- TypeScript samples: Node.js 18 or later
- Python samples: Python 3.10 or later
- Qoder authentication configured as described above

Each sample is self-contained. Open its README for installation and run
commands.

## Compatibility

The sample manifests declare compatible SDK version ranges, while the
repository lockfiles record the exact versions used by CI.

Last verified on July 20, 2026:

- TypeScript SDK 1.0.15
- Python SDK 1.0.9

## License and terms

The sample source code is licensed under the [MIT License](LICENSE). Use of the
Qoder Agent SDK and Qoder services is governed by the
[Qoder Product Service Terms](https://qoder.com/product-service).
