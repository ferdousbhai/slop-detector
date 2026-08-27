# Privacy Policy: Slop Detector

_Last updated: August 27, 2026_

Slop Detector ships as a Chrome extension and an npm CLI. Detection in both
runs locally with deterministic pattern matching. Slop Detector does not run a
model, contact a server, or include analytics or telemetry.

## Chrome extension

The extension does **not** collect, transmit, sell, or share user data.

- Visible page text is analyzed in memory and is not persisted.
- Text pasted into the popup is analyzed in memory and is not persisted.
- Selected text is held briefly in in-memory session storage, removed when the
  popup retrieves it, and never persisted to disk.
- Findings are discarded when the page closes.
- The extension makes no network requests.

The extension persistently stores one `autoScanPages` on/off preference in
`chrome.storage.sync`. It contains no page or draft text.

### Chrome permissions

- `contextMenus` adds the **Check selection for slop** menu item, which opens
  the extension popup without injecting results into the page.
- `storage` saves the auto-scan preference and holds a context-menu selection
  in memory until the popup retrieves it.
- The `<all_urls>` content script reads visible text so it can underline local
  findings. It does not hide, replace, or upload page content.

## npm CLI

The CLI reads only the paths or stdin supplied to it. It does not transmit file
contents, assistant output, diagnostics, or configuration.

## Changes

Policy changes are published in this repository. The source is available at
https://github.com/ferdousbhai/slop-detector.

## Contact

Open questions or reports at
https://github.com/ferdousbhai/slop-detector/issues.
