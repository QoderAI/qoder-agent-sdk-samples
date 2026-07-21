# Custom tools

Expose application functions to the agent as in-process MCP tools. This sample
implements a release-readiness assistant with two tools:

- `get_build_status`
- `get_open_incidents`

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start
```

The checked-in `data.json` simulates application-owned release data. Replace
`loadData()` with calls to your CI and incident-management clients in a real
application. Both tools are read-only and explicitly pre-approved for the
session.
