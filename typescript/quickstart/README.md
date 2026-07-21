# Quickstart

Run one repository-aware query and print the assistant response.

## Run

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start -- /path/to/repository
```

An optional prompt can follow the repository path:

```bash
npm start -- /path/to/repository "Describe the test strategy."
```

The sample limits the agent to the read-only `Read`, `Glob`, and `Grep` tools.
