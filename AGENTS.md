# Contract

This file lists what Slop Detector promises its users and what every change
must keep true. It binds any model or person working in this repository.

## Changing this contract

- A change that removes, weakens, or works around anything below needs the
  owner's explicit approval in the conversation where it happens. A refactor,
  a cleanup, or a release is not approval.
- The commit that makes such a change edits this file in the same commit and
  says in its message what changed and why.
- If a guarantee gets in the way of a task, stop and ask. Do not drop it
  quietly and do not reinterpret it.
- Adding a guarantee is welcome. Add a test for it, and name that test here.

## User-facing behavior

Each line is a feature users rely on. Keep it working, keep its test passing,
and keep README.md and STORE_LISTING.md describing it.

| Guarantee | Guarded by |
|---|---|
| Auto-scan underlines findings in visible page text. | `test-scanner.js`: "slop paragraph gets underline ranges on the exact phrases" |
| Underline color follows the rule's severity: red for major, amber for minor. A minor finding inside a major one draws no second line but still counts and shows on hover. | `test-scanner.js`: "each underline is colored by its rule's severity, with major painted over minor" |
| Hovering an underline shows every finding under the pointer with its rule ID, severity, and message. | `test-scanner.js`: "hovering an underline shows the rule and why it fired" |
| The toolbar badge shows the page's finding count. | `test-extension.js`: "background maps scanner counts to tab-scoped action state" |
| The popup checks pasted text and shows a verdict, a score, the marked text, and each finding's rule, severity, and message. | `extension/popup.js` (no automated test yet) |
| Right-clicking selected text opens it in the popup. | `test-extension.js`: "context-menu selections open in the extension popup" |
| The auto-scan toggle turns page scanning off and on. | `test-scanner.js`: "toggle off clears highlights and the toolbar count" |
| The CLI lints repositories and agent output, with exit code 1 on errors and JSON on request. | `test-cli.js` |

The rule behind a finding is always visible wherever the finding appears. An
underline, a highlight, or a count with no way to see why it fired breaks this
contract.

## Invariants

- Nothing in `extension/` makes a network request, loads remote code, or sends
  telemetry. Guarded by `test-extension.js`: "the extension stays local and
  keeps its permission set".
- The manifest asks for `contextMenus` and `storage` and nothing more. A new
  permission changes the store review and the privacy policy, so it needs
  approval. Same test.
- The extension persists only the `autoScanPages` preference. A context-menu
  selection is held in session storage until the popup reads it. PRIVACY.md
  says exactly this and must change with it.
- Findings are drawn with CSS Custom Highlights. Nothing inside `<body>` is
  added, removed, wrapped, replaced, recolored, or hidden. Guarded by
  `test-scanner.js`: "highlighting leaves page DOM nodes unchanged".
- The only element the extension adds to a page is the hover label: a sibling
  of `<body>` with a closed shadow root, shown in the top layer, and never
  scanned as page text. Another element on the page needs approval.
- `extension/engine.js` is the only rule source. The CLI, the popup, and the
  page scanner all call it.
- Each rule has one severity, a message that says what was found, and an
  instruction that says how to fix it, and `docs/rules.md` lists it. Guarded
  by `test.js`: "every rule has one severity and an instruction, and
  docs/rules.md lists it".

## Working rules

- Run `npm run check` and `npm test` before every commit. Both must pass.
- `package.json` and `extension/manifest.json` carry the same version.
  `npm run check:versions` enforces it.
- A commit message says why, not only what. "Prepare release" alone is not
  enough for a commit that also removes behavior.
- Prose in this repository passes its own linter (`npm run lint`).
