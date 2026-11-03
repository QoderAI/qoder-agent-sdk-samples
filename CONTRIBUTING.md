# Contributing

Thanks for helping improve the Qoder Agent SDK samples. This repository is a set
of focused, runnable examples, so contributions are judged first on clarity: a
reader should be able to open one sample and understand a single SDK concept.

## Ways to contribute

- **Report a problem.** Open an issue if a sample fails to run, is unclear, or
  drifts from current SDK behavior. Include the sample, language, SDK version,
  and the exact command and output.
- **Improve docs.** Fix or clarify READMEs, comments, and diagrams.
- **Add a new sample.** New samples are welcome. Please open an issue first to
  agree on the concept and scope before writing code, so your effort lands.

Issues about the SDK itself (rather than these samples) belong in the
[Qoder Agent SDK documentation](https://docs.qoder.com/en/cli/sdk) channels, not
this repository.

## Development setup

- TypeScript: Node.js 18 or later. From `typescript/`, run `npm install` to
  install every sample workspace, then `npm start` inside a sample directory.
- Python: Python 3.10 or later. Each sample runs from its own virtual
  environment (see the sample README). Maintainer checks use
  [`uv`](https://docs.astral.sh/uv/); contributors do not need `uv` to run a
  sample.
- Java: JDK 11 or later (17 recommended) and Maven 3.6.3 or later. Run
  `mvn clean verify` from `java/`, or build a sample from its own directory.

## Sample requirements

### Focused samples

Every sample must:

- Demonstrate one primary SDK concept.
- Ship in both TypeScript and Python with equivalent behavior.
- Use only public exports from the released SDK package.
- Use a documented SDK authentication helper and never hard-code credentials.
- Never log credentials or accept them as command-line arguments.
- Default to the smallest practical tool set and permission scope.
- Include a README with prerequisites, setup, run commands, and safety notes.
- Avoid shared source modules that hide the SDK calls being demonstrated.
- Keep generated files and expected model output out of the sample directory.

Java coverage is incremental. Keep Java ports behaviorally equivalent and mark
missing Java entries with an em dash in both indexes.
Document differences required by the released Java API and verify them with the
actual SDK/CLI pair. Adding a Java port of an existing concept does not require
porting unrelated concepts.

## Adding a new sample

Use an existing sample (for example, `quickstart`) as a template, then register
the new sample everywhere it needs to appear. Replace `<sample>` with your
kebab-case sample name.

1. **Create the TypeScript sample** at `typescript/<sample>/` with one or more
   runnable `.ts` entry files, `README.md`, and `package.json`. Copy
   `package.json` from an existing sample and update the `name` field to
   `@qoder-samples/typescript-<sample>`.
2. **Create the Python sample** at `python/<sample>/` with one or more runnable
   `.py` entry files, `README.md`, and `requirements.txt`.
3. **Register the TypeScript workspace:** add `<sample>` to the `workspaces`
   array in `typescript/package.json`.
4. **Register the Python type check:** add `<sample>` to the `for sample in ...`
   loop in `.github/workflows/ci.yml` and to the matching loop in this file.
5. **List it in both READMEs:** add a row to the sample table in `README.md` and
   in `README.zh-CN.md`.

For a Java port, create `java/<sample>/` with a standalone `pom.xml`, a README,
and sources under `src/main/java`. Register it in `java/pom.xml` and both sample
indexes. The Java CI job builds every registered module. Pin a released Central
SDK version, compile with `--release 8`, and keep the sample independent of
the aggregator and any SDK source checkout. Tests must run without credentials
or a real CLI; document real queries as opt-in checks.

When updating the Java SDK, update every sample's `qoder.sdk.version` and any
explicit dependency versions, both root README compatibility lists, the Java
overview coordinate, and affected sample requirements. Validate the published
artifact using an empty Maven local repository:

```bash
cd java
mvn -B -ntp -Dmaven.repo.local=/path/to/empty/maven-cache clean verify
```

Use Central or a verified Central mirror, and build each changed sample from
its own directory as well. For real queries, use the SDK's managed CLI; record
the SDK/CLI versions and platform actually exercised. Keep historical
verification records accurate. A newer version in registry metadata or a green
compile is not a real-runtime compatibility result.

Keep the TypeScript and Python versions behaviorally equivalent so readers can
switch between languages. When one concept has multiple independently copyable
variants, keep them in one sample directory and list every entry in its README.

### Comprehensive application templates

An application template may be language-specific when its framework and application architecture are part of what it teaches. It must demonstrate one coherent end-to-end application, keep SDK calls easy to locate, document module ownership, provide deterministic credential-free tests, and include an opt-in real-SDK smoke path.

## Running the checks

Run the same checks CI runs, and make sure they pass before opening a pull
request:

```bash
cd typescript && npm ci && npm run check --workspaces
cd ../python && uv sync && uv run ruff check . && uv run ruff format --check .
for sample in quickstart multi-turn-conversation streaming-chat code-review tool-permissions ask-user-question model-selection hooks custom-tools subagents external-session-storage; do
  uv run mypy "$sample"
done
cd ../java && mvn -B -ntp clean verify
```

If `ruff format --check` reports changes, run `uv run ruff format .` to apply
them.

## Pull requests

- Keep each pull request focused on one sample or one concern.
- Explain what the sample demonstrates and how you verified it.
- Ensure CI is green; pull requests are not merged with failing checks.

## Contributor terms

By submitting a pull request, you agree that your contribution is provided under
the repository's [MIT License](LICENSE) and that you have the right to submit it.
