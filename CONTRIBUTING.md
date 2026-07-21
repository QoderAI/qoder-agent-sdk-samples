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

## Sample requirements

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

## Adding a new sample

Use an existing sample (for example, `quickstart`) as a template, then register
the new sample everywhere it needs to appear. Replace `<sample>` with your
kebab-case sample name.

1. **Create the TypeScript sample** at `typescript/<sample>/` with `index.ts`,
   `README.md`, and `package.json`. Copy `package.json` from an existing sample
   and update the `name` field to `@qoder-samples/typescript-<sample>`.
2. **Create the Python sample** at `python/<sample>/` with `main.py`,
   `README.md`, and `requirements.txt`.
3. **Register the TypeScript workspace:** add `<sample>` to the `workspaces`
   array in `typescript/package.json`.
4. **Register the Python type check:** add `<sample>` to the `for sample in ...`
   loop in `.github/workflows/ci.yml` and to the matching loop in this file.
5. **List it in both READMEs:** add a row to the sample table in `README.md` and
   in `README.zh-CN.md`.

Keep the TypeScript and Python versions behaviorally equivalent so readers can
switch between languages.

## Running the checks

Run the same checks CI runs, and make sure they pass before opening a pull
request:

```bash
cd typescript && npm ci && npm run check --workspaces
cd ../python && uv sync && uv run ruff check . && uv run ruff format --check .
for sample in quickstart multi-turn-conversation streaming-chat code-review tool-permissions ask-user-question model-selection hooks custom-tools subagents; do
  uv run mypy "$sample/main.py"
done
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
