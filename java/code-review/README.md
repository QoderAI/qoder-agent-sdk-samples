# Code review

Collect a bounded Git diff in the host application and ask the model to review
it with read-only repository tools.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.3` from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. Choose a workspace
whose contents you may send to Qoder; assistant output can include that content.
Do not put credentials in prompts or command arguments.

## Run

Git must be on PATH, and the target must have at least one commit. From this
directory, review tracked staged and unstaged changes relative to HEAD:

```bash
mvn compile exec:java -Dexec.args='--workspace "/path/to/git-repository"'
```

Review a branch relative to its merge base with another branch:

```bash
mvn compile exec:java -Dexec.args='--workspace "/path/to/git-repository" --base main --head HEAD'
```

Without `--base`, the comparison is `git diff <head>` against the working tree.
With `--base`, it is `git diff <base>...<head>`. The sample does not fetch remote
refs. Untracked file contents are not included.

## Boundaries

Git runs through an argument list, never a shell. Option-like or malformed
revision names are rejected, external diff/textconv programs are disabled, and
output is capped at 100,000 bytes with a 30-second read timeout. Only Git's
stdout becomes the diff; warnings and other stderr diagnostics are discarded
rather than sent to the model. Empty diffs and Git failures stop before
contacting the model; oversized diffs must be narrowed.

The model sees the diff and may use `Read`, `Glob`, and `Grep` to inspect
context. Bash and write tools are not exposed. The prompt requests concrete
findings with severity, file, location, explanation, and a fix, or an explicit
no-findings answer. Findings are model output and still need human review.
The model is `auto`, with a six-turn limit.

Assistant messages print once; an error/unknown result or missing result fails
the run. The Git process, reader worker, SDK cursor, and client are cleaned up.
Diagnostics report exception types without dumping diff content or raw errors.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests use temporary Git repositories to cover working-tree and merge-base diffs,
empty and invalid revisions, excluded untracked files, stderr exclusion, and the
byte limit.
For a real check, introduce a small deliberate bug in a disposable repository
and run the first command.
