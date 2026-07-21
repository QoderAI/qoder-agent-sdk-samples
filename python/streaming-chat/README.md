# Streaming chat

Build a multi-turn terminal chat with incremental text output.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py --workspace /path/to/repository
```

Enter `/exit` or submit an empty prompt to close the session.

Scripted mode accepts each turn as a separate argument:

```bash
python main.py --workspace /path/to/repository \
  "Summarize this repository." \
  "Which module should I read first?"
```

The sample uses `QoderSDKClient` to keep one session open and enables partial
messages for incremental text rendering.
