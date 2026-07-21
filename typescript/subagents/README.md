# Subagents

Define specialized agents in SDK options and let the main agent delegate work
through the built-in `Agent` tool.

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start -- /path/to/repository
```

The sample registers an architecture explorer and a test strategist. Both
subagents receive only read-only repository tools. The main agent receives
only the `Agent` delegation tool and synthesizes their findings.
