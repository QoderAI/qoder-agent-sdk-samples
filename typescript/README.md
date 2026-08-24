# TypeScript samples

Each directory is an independent Node.js project. To install all samples at
once, run:

```bash
npm install
```

Run a sample with the script documented in its README; most use `npm start`.
Complete the repository-level setup before running a sample.

## Application template

[`web-ui-showcase`](web-ui-showcase) is a complete Fastify and React application template backed by the Qoder TypeScript SDK. Its Chinese light-theme product UI covers first-send Workspace selection, automatically available Sessions, SDK-backed Command and Skill discovery, project-scoped `@ Files`, semantic streaming, locally expandable Tool details, inline Approval and MCP elicitation, Task state, Credits, safe errors, snapshot recovery, and graceful shutdown. Model and Permission Mode are selected directly in the Composer; MCP, Hooks, and Raw Events live in the default-closed SDK Console, and `/mcp` opens its MCP tab. Eligible user messages expose a Checkpoint dry-run, impact review, and confirmed files/conversation rewind. Task state and server/API control adapters are included, but the current React product has no reachable Task controls. The Chinese sample README routes readers to copyable SDK examples, a source tour, deterministic acceptance tests, a product trial guide, and the optional real-account smoke.
