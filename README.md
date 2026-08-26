# Slop Detector

Slop Detector finds AI-flavored writing with local, deterministic rules. The
repository ships two products from the same detection engine:

| Distribution | What it contains | Install |
| --- | --- | --- |
| Chrome extension | Page underlines, popup checker, and selection checker | Chrome Web Store ZIP built from `extension/` |
| npm package | Repository linter, agent-output linting, and hook installers | `npm install @ferdousbhai/slop-detector` |

The Chrome ZIP does not contain or install coding-agent hooks. Hooks ship in the
npm package through the `slop-detector` executable. Both distributions use
`extension/engine.js`, so browser and CLI findings stay identical without a
model call or network request.

## Browser extension

The extension can:

- underline findings on visible page text without changing page colors or DOM;
- check pasted drafts in its popup;
- check selected text from the context menu; and
- show the rule ID for each marked phrase.

To load it from source:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**, then choose `extension/`.

Chrome Web Store packaging and release steps are in
[`docs/releasing.md`](docs/releasing.md).

## npm CLI

Install it in a project:

```bash
npm install --save-dev @ferdousbhai/slop-detector
npx slop-detector .
```

Or install it for your user:

```bash
npm install --global @ferdousbhai/slop-detector
slop-detector .
```

The linter checks Git-tracked and non-ignored files. It extracts prose from
documents, comments, strings, HTML attributes, and visible template text. It
skips dependencies, generated output, lockfiles, binaries, symlinks, and files
larger than 1 MB.

Major findings are errors. Minor findings are warnings. Errors return exit code
1, which makes the command suitable for CI.

```bash
slop-detector . --max-warnings=0
slop-detector docs/ README.md --format=json
slop-detector . --quiet
```

### Agent output

`agent` reads one completed answer from stdin. Detection remains local; only the
agent runtime can decide to request a revision.

```bash
printf '%s' "$AGENT_OUTPUT" | slop-detector agent
printf '%s' "$AGENT_OUTPUT" | slop-detector agent --format=json
```

JSON output includes diagnostics, counts, compact deterministic revision
feedback, and a warning nudge for runtimes that support one-time guidance.

## Agent hooks

Install every user-scoped integration:

```bash
slop-detector install-hooks
```

Select agents or inspect changes first:

```bash
slop-detector install-hooks --agents=claude,codex
slop-detector install-hooks --dry-run --format=json
```

Project scope installs the four project-capable integrations by default:

```bash
slop-detector install-hooks --scope=project
```

| Agent | Final-output gate | Warning context | Scope |
| --- | --- | --- | --- |
| Claude Code | `Stop` | none | user or project |
| Codex CLI | `Stop` | none | user or project |
| Gemini CLI | `AfterAgent` | not available | user or project |
| OMP | `session_stop` | `before_agent_start` | user or project |
| Ghost | `session_stop` | none | user only |

Errors can request one revision. Warnings never block and never cause an extra
model call. Claude, Codex, and Ghost report warnings only at Stop, so clean turns
add no Slop Detector context. OMP saves compact, rule-specific guidance by
session ID and consumes it on the next user-initiated turn. The state contains
rule IDs, counts, and static guidance, not the response text.

The installer merges existing settings, writes a one-time
`.slop-detector.bak`, preflights every requested configuration before writing,
and is safe to run again after package or Node upgrades. Codex may require
one-time approval in
`/hooks`.

See [`docs/agent-hooks.md`](docs/agent-hooks.md) for paths, protocols, warning
state, trust boundaries, and manual configuration.

## Configuration

Create `.slopdetector.json` in a repository, or
`~/.config/slop-detector/config.json` for user-wide defaults:

```json
{
  "ignore": ["docs/quoted-material/**", "test/fixtures/**"],
  "rules": {
    "ai-vocabulary": "off",
    "em-dash-density": "error"
  }
}
```

Rule levels are `"off"`, `"warn"`, or `"error"`. Repository settings override
user settings. Use `--config path/to/config.json` to select a file explicitly.

## JavaScript API

The npm package exposes the shared engine and repository linter:

```js
const { analyze } = require("@ferdousbhai/slop-detector");
const { lintText } = require("@ferdousbhai/slop-detector/linter");
```

`@ferdousbhai/slop-detector/engine` is an explicit alias for the shared engine.
The hook protocol and installer modules are internal; use the CLI so package
updates can change those adapters safely.

## Project layout

```text
extension/            Chrome extension and canonical rule engine
bin/                  npm executable
lib/                   repository linting and agent-hook modules
scripts/               package and release verification
.github/workflows/     CI, release preparation, and trusted npm publishing
docs/                  architecture, hooks, and release documentation
```

The repository intentionally is not an npm workspace. It publishes one npm
package and one version-coupled Chrome artifact. See
[`docs/architecture.md`](docs/architecture.md) for the boundaries and rationale.

## Development

```bash
npm ci
npm run check
npm test
npm run verify:package
```

`verify:package` packs the npm allowlist, installs the tarball into a clean
consumer project, checks both public exports, runs the installed lint gate, and
installs Claude, Codex, OMP, and Ghost hooks into a temporary home.

## Release

The extension manifest and npm package share one version and one `vX.Y.Z` tag.
Tagging creates a draft GitHub Release with separate Chrome and npm artifacts.
Publishing that GitHub Release triggers npm trusted publishing. Chrome upload
remains a separate Web Store step.

See [`docs/releasing.md`](docs/releasing.md) for the exact checklist.

## Privacy and limitations

Detection is rule-based and local. It flags writing patterns, not authorship. A
clean result cannot prove who wrote the text.

The browser extension collects no user data. The CLI stores only short,
session-keyed warning guidance when its hooks are enabled. Details are in
[`PRIVACY.md`](PRIVACY.md).

## License

[MIT](LICENSE)
