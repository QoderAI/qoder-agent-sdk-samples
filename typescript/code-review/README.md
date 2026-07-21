# Code review

Review a Git diff while allowing the agent to inspect surrounding repository
code with read-only tools.

Complete the [repository setup](../../README.md#setup). Review uncommitted
changes:

```bash
npm install
npm start -- --workspace /path/to/repository
```

Review a revision range:

```bash
npm start -- --workspace /path/to/repository --base origin/main --head HEAD
```

The host application obtains the diff with `git` without invoking a shell. The
agent receives the diff in the prompt and can only use `Read`, `Glob`, and
`Grep` to inspect repository context. Diffs larger than 100 KB are rejected.
