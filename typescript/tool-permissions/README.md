# Tool permissions

Demonstrate three separate permission controls:

- `tools` limits which tools the model can see.
- `allowedTools` pre-approves the read-only tools.
- `canUseTool` evaluates the remaining `Bash` request at runtime.

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start -- /path/to/git/repository
```

The callback allows only `git status --short`, `git status --porcelain`, and
their `--no-pager` equivalents. It denies every other shell command. The sample
does not modify the repository.
