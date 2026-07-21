# Multi-turn conversation and query lifecycle

Build an interactive terminal application that keeps conversation context while
giving the user direct control over the query lifecycle.

```text
             ordinary prompt
                   |
                   v
closed -- /resume --> open <--> generating
  ^                    |            |
  |                  /close       Ctrl+C
  |                    |            |
  +--------------------+            +--> open and idle

session_id is preserved across /close -> /resume
```

Complete the [repository setup](../../README.md#setup), then:

```bash
npm install
npm start -- /path/to/repository
```

Application commands:

| Command | Behavior |
| --- | --- |
| `/status` | Show the current query, turn, and session state |
| `/close` | Explicitly close the query while retaining its session ID |
| `/resume` | Create a new query that resumes the retained session |
| `/exit` | Close the query and exit the application |

Try asking the application to remember a value, run `/close`, run `/resume`,
and ask for the value again. To exercise interruption, request a long analysis
and press `Ctrl+C` while output is being generated. The current turn stops, but
the application and query remain open.

The application consumes SDK messages in a background task so lifecycle
commands remain available during generation. All repository tools are
read-only.
