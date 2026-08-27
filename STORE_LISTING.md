# Chrome Web Store listing

## Upload package

Upload `dist/slop-detector-chrome-store-v1.1.1.zip`. It contains the committed
`extension/` tree with `manifest.json` at the ZIP root. Build it from a clean
working tree:

```bash
npm run package:chrome
```

See [`docs/releasing.md`](docs/releasing.md) for versioning and release steps.

## Listing

- **Name**: Slop Detector
- **Summary** (132 chars max): Red-pen linting for AI-flavored writing.
  Underlines slop on any page; check drafts in the popup.
- **Category**: Tools
- **Language**: English (US)

### Description

Red-pen linting for AI-flavored writing.

Slop Detector lints prose for the telltale patterns of AI-generated writing —
chatbot phrases ("I hope this message finds you well"), puffery ("marks a
pivotal moment"), vague attribution ("experts believe"), binary contrasts
("It's not just X, it's Y"), em-dash density, uniform sentence rhythm, emoji
bullets, and a larger catalog of recurring prose patterns.

- Auto-scan: visible text on every page is linted automatically. Findings get
  a wavy red underline via the CSS Custom Highlight API. Existing page text is
  not wrapped, replaced, recolored, hidden, or removed.
- The toolbar badge shows the number of page findings.
- Popup checker: paste a draft, get highlighted findings and a verdict —
  READS HUMAN / SUSPICIOUS / CERTIFIED SLOP.
- Right-click any selected text → "Check selection for slop" to open it in the
  extension popup.

Pure pattern matching: fast, explainable, no ML, no network calls, everything
runs locally. Open source: https://github.com/ferdousbhai/slop-detector

## Privacy tab answers

- **Single purpose**: Lints visible page text for AI-writing patterns and
  underlines findings locally.
- **Permission justifications**:
  - `contextMenus` — adds the right-click "Check selection for slop" item.
  - `storage` — persists the auto-scan on/off toggle (synced to the user's
    Chrome profile) and briefly holds a context-menu selection in memory until
    the popup retrieves it.
  - Content script on `<all_urls>` — auto-scan must run on every site the
    user browses; the extension is a passive reader of visible text only.
- **Remote code**: none. No data collection, no analytics, no network requests.
- **Data usage disclosure**: does not collect or transmit any user data.

## Store assets

- `store-assets/screenshot-popup-certified-slop.png` — 1280×800 screenshot.
- `store-assets/screenshot-page-underlines.png` — 1280×800 screenshot.
- `store-assets/promo-small-440x280.png` — small promo tile.
- `store-assets/promo-marquee-1400x560.png` — marquee promo.

## Review expectations

`<all_urls>` content scripts trigger deeper review; expect a few days.
Justification text above maps each permission to user-visible behavior.
