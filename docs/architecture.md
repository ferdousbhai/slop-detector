# Architecture

Slop Detector has one rule engine, one Chrome distribution, and no runtime
dependencies. Node tooling exists for development and repository-level checks
but is not published as a package.

## Module boundaries

```text
extension/engine.js
  ├─ browser extension UI and scanner
  └─ lib/linter.js
       ├─ repository checks
       └─ agent-output checks

bin/slop-detector.js
  └─ check and agent commands
```

### Detection engine

`extension/engine.js` is the canonical rule source. Its pattern catalog draws
on dmmulroy/anti-slop (architecture), the Cursor plugins unslop skill,
petergyang/no-ai-slop (pattern lists), and the declauding skill in
oaustegard/claude-skills (structural tics). It exposes
`globalThis.SlopEngine` when loaded as a Chrome script and `module.exports` when
required by Node. Keeping this small dual-runtime wrapper avoids a bundler,
copy step, or generated browser artifact.

`analyze(text, options)` reads plain text, so callers pass the two facts that
flattening removes. `heading` marks the text as a heading, and `boldLead` is the
length of a bold run that opens the block. Markdown needs neither option because
the engine reads `#` and `**` itself.

### Repository linter

`lib/linter.js` adapts the engine to files. It owns configuration, ignore
matching, Git-aware file discovery, prose extraction, source segmentation,
locations, and model-ready diagnostic text.

### CLI

`bin/slop-detector.js` parses arguments, reads bounded stdin, selects a command,
and formats terminal or JSON output.

## Distribution boundary

The Chrome ZIP is created from `HEAD:extension`. Its manifest sits at the ZIP
root, as required by the Chrome Web Store. Repository tooling, tests,
documentation, and store-source assets are not included.

## Single package, no workspace

There is one private npm project and one canonical engine. Workspaces would add
package manifests, linking, and build boundaries without creating an
independently released package. A split becomes useful only if the engine or
repository tooling gains its own distribution lifecycle.

## Trust and data boundaries

- Detection is local and deterministic.
- Content scripts register CSS Custom Highlights and do not add, remove, wrap,
  or replace host-page DOM nodes inside `<body>`. The one element they add is
  the hover label: a sibling of `<body>` with a closed shadow root, shown in
  the top layer, and never read as page text.
- Repository files and agent-output stdin are treated as untrusted input and
  bounded to 1 MB per file or payload.
- Symlinks and binary files are not scanned. A symlink named on the command
  line is an error.

## Efficiency choices

- The browser scans text blocks and invalidates only blocks affected by DOM text
  mutations.
- Git repositories use `git ls-files` instead of walking ignored directories.
- Non-Git traversal prunes configured ignored paths before descending.
- Duplicate diagnostics are removed before reporting.
- Agent-output feedback contains only violations and instructions.

## Public surface

The supported public surface is the Chrome extension. The CLI and Node modules
are source-tree development tools rather than versioned package interfaces.
