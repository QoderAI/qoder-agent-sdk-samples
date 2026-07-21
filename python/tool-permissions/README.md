# Tool permissions

Demonstrate three separate permission controls:

- `tools` limits which tools the model can see.
- `allowed_tools` pre-approves the read-only tools.
- `can_use_tool` evaluates the remaining `Bash` request at runtime.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py /path/to/git/repository
```

The callback allows only `git status --short`, `git status --porcelain`, and
their `--no-pager` equivalents. It denies every other shell command. The sample
does not modify the repository.
