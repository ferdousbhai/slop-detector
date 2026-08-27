# Slop Detector

Slop Detector is a Chrome extension that finds AI-flavored writing with local,
deterministic rules. It underlines page findings, checks pasted or selected
text, and never sends content to a model or network service.

## Browser extension

The extension can:

- underline findings without wrapping, replacing, or recoloring page text;
- check pasted drafts in its popup;
- check selected text from the context menu in that popup; and
- show the page finding count on its toolbar badge.

To load it from source:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**, then choose `extension/`.

Chrome Web Store packaging and release steps are in
[`docs/releasing.md`](docs/releasing.md).

## Repository tooling

The source tree includes a CLI for testing the shared rules against repository
content:

```bash
npm ci
node bin/slop-detector.js .
```

The linter checks Git-tracked and non-ignored files. It extracts prose from
documents, comments, strings, HTML attributes, and visible template text. It
skips dependencies, generated output, lockfiles, binaries, symlinks, and files
larger than 1 MB.

Major findings are errors. Minor findings are warnings. Errors return exit code
1, which makes the command suitable for CI.

```bash
node bin/slop-detector.js . --max-warnings=0
node bin/slop-detector.js docs/ README.md --format=json
node bin/slop-detector.js . --quiet
```

### Agent output

`agent` reads one completed answer from stdin. Detection remains local; only the
agent runtime can decide to request a revision.

```bash
printf '%s' "$AGENT_OUTPUT" | node bin/slop-detector.js agent
printf '%s' "$AGENT_OUTPUT" | node bin/slop-detector.js agent --format=json
```

JSON output includes diagnostics, counts, and compact deterministic revision
feedback.

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

## Project layout

```text
extension/            Chrome extension and canonical rule engine
bin/                  repository-development CLI
lib/                  repository linting
scripts/              Chrome packaging and release verification
.github/workflows/    CI and Chrome release preparation
docs/                  architecture and release documentation
```

The npm project is private and exists only to install development dependencies
and run repository scripts. See [`docs/architecture.md`](docs/architecture.md)
for the boundaries and rationale.

## Development

```bash
npm ci
npm run check
npm test
```

## Release

The extension manifest owns the release version. Tagging a matching `vX.Y.Z`
creates a draft GitHub Release containing the Chrome Store ZIP and its checksum.
Upload that ZIP to the Chrome Web Store and submit it for review.

See [`docs/releasing.md`](docs/releasing.md) for the exact checklist.

## Privacy and limitations

Detection is rule-based and local. It flags writing patterns, not authorship. A
clean result cannot prove who wrote the text.

The browser extension collects no user data. Details are in
[`PRIVACY.md`](PRIVACY.md).

## License

[MIT](LICENSE)
