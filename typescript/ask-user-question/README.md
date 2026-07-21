# Ask user question

Respond to the built-in `AskUserQuestion` tool from an application-owned
terminal interface.

```text
Agent -- questions --> canUseTool callback --> terminal UI --> user
  ^                                                        |
  +------------ updatedInput { questions, answers } -------+
```

The sample renders question headers, option labels, and descriptions. It
supports single-select questions, comma-separated multi-select answers, and
free-text answers.

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start
```

Press Enter to accept the first option, enter an option number such as `2`, or
enter comma-separated numbers such as `1,3` for a multi-select question. Any
non-numeric input is returned as a custom answer.

The callback preserves the original question objects and adds an `answers`
object keyed by the exact question text. Every tool other than
`AskUserQuestion` is denied so the interaction stays focused.
