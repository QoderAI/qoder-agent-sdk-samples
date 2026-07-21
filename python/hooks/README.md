# Hooks

Attach deterministic application logic to representative agent lifecycle
events in one read-only repository inspection.

```text
SessionStart -> UserPromptSubmit -> PreToolUse -> tool -> PostToolUse
                                                        |
                                                     Stop
```

The sample demonstrates:

| Hook | Application behavior |
| --- | --- |
| `SessionStart` | Record session creation and inject session-wide context |
| `UserPromptSubmit` | Add application instructions to the submitted prompt |
| `PreToolUse` | Allow only an exact read-only `git status` command |
| `PostToolUse` | Record successful tools and add context after Bash |
| `Stop` | Observe completion without changing model behavior |

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py /path/to/git/repository
```

An optional prompt can follow the repository path. Keep it compatible with the
sample policy: Bash requests other than the documented `git status` forms are
denied. `QoderSDKClient` keeps the connection alive until the response and
lifecycle hooks finish. Hook callbacks run in-process and should return quickly.
