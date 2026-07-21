# Streaming chat

Build a multi-turn terminal chat with incremental text output.

Complete the [repository setup](../../README.md#setup). Interactive mode:

```bash
npm install
npm start -- --workspace /path/to/repository
```

Enter `/exit` or submit an empty prompt to close the session.

Scripted mode accepts each turn as a separate argument:

```bash
npm start -- --workspace /path/to/repository \
  "Summarize this repository." \
  "Which module should I read first?"
```

The sample keeps one SDK session open, enables partial messages, and sends the
next user message only after the previous turn completes.
