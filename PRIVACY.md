# Privacy Policy: Slop Detector

_Last updated: August 23, 2026_

Slop Detector ships as a Chrome extension and an npm CLI. Detection in both
runs locally with deterministic pattern matching. Slop Detector does not run a
model, contact a server, or include analytics or telemetry.

## Chrome extension

The extension does **not** collect, transmit, sell, or share user data.

- Visible page text is analyzed in memory and is not persisted.
- Text pasted into the popup is analyzed in memory and is not persisted.
- Findings are discarded when the page closes.
- The extension makes no network requests.

The extension stores one `autoScanPages` on/off preference in
`chrome.storage.sync`. It contains no page or draft text.

### Chrome permissions

- `contextMenus` adds the **Check selection for slop** menu item.
- `storage` saves the auto-scan preference.
- The `<all_urls>` content script reads visible text so it can underline local
  findings. It does not hide, replace, or upload page content.

## npm CLI and agent hooks

The CLI reads only the paths or stdin supplied to it. It does not transmit file
contents, assistant output, diagnostics, or configuration.

When agent hooks find a warning, the CLI may save a short advisory under
`$XDG_STATE_HOME/slop-detector/session-nudges/` or the fallback
`~/.local/state/slop-detector/session-nudges/`. The advisory contains:

- a SHA-256-derived filename based on the agent session ID;
- lint rule IDs and occurrence counts;
- static rule guidance; and
- a creation timestamp.

It does **not** contain the assistant response, matched text, user prompt, or
conversation. The next prompt hook consumes the advisory once. Entries older
than seven days are ignored and pruned periodically.

A supported agent may send its own conversation to its configured model when a
hook requests a revision or when the user sends the next prompt. That traffic
belongs to the agent and model provider; Slop Detector neither creates nor
proxies it.

## Changes

Policy changes are published in this repository. The source is available at
https://github.com/ferdousbhai/slop-detector.

## Contact

Open questions or reports at
https://github.com/ferdousbhai/slop-detector/issues.
