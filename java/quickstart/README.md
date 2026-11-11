# Quickstart

Run one repository-aware query and print the assistant response. This sample
uses only the public API of Java SDK 0.2.4, resolved from Maven Central.

## Run

Install JDK 11 or later (17 recommended) and Maven 3.6.3 or later. Complete the
[repository authentication setup](../../README.md#setup), supplying
`QODER_PERSONAL_ACCESS_TOKEN` through your environment. From this directory:

```bash
mvn compile exec:java -Dexec.args='"/path/to/repository"'
```

An optional prompt can follow the repository path:

```bash
mvn compile exec:java -Dexec.args='"/path/to/repository" "Describe the test strategy."'
```

With no arguments the sample inspects the current directory. The first run
downloads the SDK's pinned CLI 1.1.80 and requires access to the Qoder download
service. Leave `QODERCLI_PATH` unset; CLI 1.1.81 and later cannot run the independent
SDK process required by SDK 0.2.4. See [Java runtime notes](../README.md#runtime).

## Behavior and permissions

The sample exposes and preapproves only `Read`, `Glob`, and `Grep`, selects
`auto`, and limits execution to four turns. Choose a directory whose contents
you are permitted to send to Qoder; read-only tools do not prevent data from
being sent to the model. Assistant output may contain repository content.
Never put a token in the prompt or command-line arguments.

`query()` returns a handle before startup finishes. The cursor receives startup
and runtime failures, prints assistant text, and reads through EOF. An error,
unknown result, or stream without a successful result fails the run. The cursor
and client are closed on success and failure. The result text is not printed a
second time. Failures exit nonzero and report only the exception type, avoiding
raw exception details or credential logging.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests exercise message handling, failure propagation, cursor cleanup, and the
read-only tool configuration using the public SDK API. They do not start a CLI
or require credentials. This POM also works when copied without the parent
samples repository.

For an opt-in real query, use a small repository with no sensitive content and
run the command above with the prompt `Summarize README.md in one sentence.`
A successful process exit confirms a successful SDK result and EOF; the exact
model wording is not an assertion. This query uses your Qoder account and may
consume credits.
