# Quickstart

Run one repository-aware query and print the assistant response.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py /path/to/repository
```

An optional prompt can follow the repository path:

```bash
python main.py /path/to/repository "Describe the test strategy."
```

The sample limits the agent to the read-only `Read`, `Glob`, and `Grep` tools.
