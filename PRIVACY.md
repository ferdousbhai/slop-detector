# Privacy Policy — Slop Detector

_Last updated: August 21, 2026_

Slop Detector lints visible page text for AI-writing patterns and underlines
findings locally. It is designed to work entirely on your device.

## Data collection

Slop Detector does **not** collect, store, transmit, sell, or share any user
data. Specifically:

- **No network requests.** All analysis is pure pattern matching that runs
  locally in your browser. The extension never contacts any server.
- **No analytics or telemetry.** Nothing is tracked or measured.
- **Page text is never stored or sent anywhere.** Text is read only to be
  analyzed in memory on your device; findings are rendered as highlights and
  discarded when you leave the page.
- **Text you paste into the popup** is analyzed in memory and never persisted
  or transmitted.

## What the extension stores

The only thing Slop Detector persists is a single on/off preference (the
auto-scan toggle), saved via `chrome.storage.sync` so it follows your Chrome
profile. It contains no personal data.

## Permissions

- `contextMenus` — adds the right-click "Check selection for slop" item.
- `storage` — persists the auto-scan toggle described above.
- Content script on all sites — auto-scan underlines findings on pages you
  visit; it is a passive reader of visible text only and never modifies,
  hides, or removes page content.

## Changes

Any change to this policy will be published in this repository. The source
code is open and auditable: https://github.com/ferdousbhai/slop-detector

## Contact

Questions: open an issue at
https://github.com/ferdousbhai/slop-detector/issues
