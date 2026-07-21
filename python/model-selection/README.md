# Model selection

Build a terminal model picker from the account's live model catalog, then apply
the selection through a dynamic model-policy callback.

```text
catalog client -> get_available_models() -> model/context/reasoning picker
                                                    |
execution client <- resolve_model(policy) -----------+
```

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

The picker displays enabled models, configurable context-window sizes, and
reasoning-effort levels from runtime metadata. Press Enter to accept each
default, or enter a displayed number or value.

The catalog and execution sessions are separate so the interactive selection
happens outside `resolve_model`. The callback remains fast and simply returns
the cached policy for each LLM request.
