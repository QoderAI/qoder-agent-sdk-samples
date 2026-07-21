# Code review

Review a Git diff while allowing the agent to inspect surrounding repository
code with read-only tools.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py --workspace /path/to/repository
```

Review a revision range:

```bash
python main.py --workspace /path/to/repository --base origin/main --head HEAD
```

The host obtains the diff by passing arguments directly to `git`; it does not
invoke a shell. The agent receives only `Read`, `Glob`, and `Grep`. Diffs larger
than 100 KB are rejected.
