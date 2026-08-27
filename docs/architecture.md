# Architecture

Slop Detector has one rule engine, two distributions, and no runtime
dependencies.

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

`extension/engine.js` is the canonical rule source. It exposes
`globalThis.SlopEngine` when loaded as a Chrome script and `module.exports` when
required by Node. Keeping this small dual-runtime wrapper avoids a bundler,
copy step, or generated browser artifact. The npm allowlist includes this file
but excludes the rest of the extension.

The package exports it at both the package root and `/engine`. Existing
consumers can keep using the root export; `/engine` makes the boundary explicit.

### Repository linter

`lib/linter.js` adapts the engine to files. It owns configuration, ignore
matching, Git-aware file discovery, prose extraction, source segmentation,
locations, and model-ready diagnostic text.

### CLI

`bin/slop-detector.js` parses arguments, reads bounded stdin, selects a command,
and formats terminal or JSON output.

## Distribution boundaries

`package.json#files` is the npm publication allowlist:

```json
[
  "bin/",
  "docs/",
  "lib/",
  "extension/engine.js",
  "PRIVACY.md"
]
```

npm always adds package metadata, README, and license files. The explicit docs
and privacy policy ship with the CLI. The package contains no browser content
script, permissions, images, or store assets.

The Chrome ZIP is created from `HEAD:extension`. Its manifest sits at the ZIP
root, as required by the Chrome Web Store. It contains no Node CLI.

## Why this is not a workspace

There is one npm package, one shared version, and one canonical engine. npm
workspaces would add package manifests, linking, version coordination, and a
build boundary without creating an independently useful package. A workspace
split becomes useful only if the engine, CLI, or extension gains an independent
release lifecycle or dependency graph.

## Trust and data boundaries

- Detection is local and deterministic.
- Content scripts register CSS Custom Highlights and do not add, remove, wrap,
  or replace host-page DOM nodes.
- Repository files and agent-output stdin are treated as untrusted input and
  bounded to 1 MB per file or payload.
- Symlinks and binary files are not scanned.

## Efficiency choices

- The browser scans text blocks and invalidates only blocks affected by DOM text
  mutations.
- Git repositories use `git ls-files` instead of walking ignored directories.
- Non-Git traversal prunes configured ignored paths before descending.
- Duplicate diagnostics are removed before reporting.
- Agent-output feedback contains only violations and instructions.

## Public surface

The supported public interfaces are:

- the `slop-detector` executable;
- `require("@ferdousbhai/slop-detector")`;
- `require("@ferdousbhai/slop-detector/engine")`; and
- `require("@ferdousbhai/slop-detector/linter")`.
