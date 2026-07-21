# Subagents

Define specialized agents in SDK options and let the main agent delegate work
through the built-in `Agent` tool.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py /path/to/repository
```

The sample registers an architecture explorer and a test strategist. Both
subagents receive only read-only repository tools. The main agent receives
only the `Agent` delegation tool and synthesizes their findings.
