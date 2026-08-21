# Chrome Web Store listing

## Upload package

`slop-detector-chrome-store-v1.0.0.zip` (contents of `extension/`, manifest at
zip root). Rebuild after changes:

```bash
cd extension && zip -qr ../slop-detector-chrome-store-v$VERSION.zip . -x "*.DS_Store"
```

## Listing

- **Name**: Slop Detector
- **Summary** (132 chars max): Red-pen linting for AI-flavored writing.
  Underlines slop on any page; check drafts in the popup.
- **Category**: Productivity → Tools? Use "Accessibility"? Recommended:
  **Productivity** or **Developer Tools**.
- **Language**: English (US)

### Description

Red-pen linting for AI-flavored writing.

Slop Detector lints prose for the telltale patterns of AI-generated writing —
chatbot phrases ("I hope this message finds you well"), puffery ("marks a
pivotal moment"), vague attribution ("experts believe"), binary contrasts
("It's not just X, it's Y"), em-dash density, uniform sentence rhythm, emoji
bullets, and ~120 more patterns across 21 rule categories.

- Auto-scan: visible text on every page is linted automatically. Findings get
  a yellow highlight + wavy red underline via the CSS Custom Highlight API —
  the page's DOM is never modified, nothing is ever hidden or removed.
- Hover any underline to see which rule triggered.
- Popup checker: paste a draft, get highlighted findings and a verdict —
  READS HUMAN / SUSPICIOUS / CERTIFIED SLOP.
- Right-click any selected text → "Check selection for slop".

Pure pattern matching: fast, explainable, no ML, no network calls, everything
runs locally. Open source: https://github.com/ferdousbhai/slop-detector

## Privacy tab answers

- **Single purpose**: Lints visible page text for AI-writing patterns and
  underlines findings locally.
- **Permission justifications**:
  - `contextMenus` — adds the right-click "Check selection for slop" item.
  - `storage` — persists the auto-scan on/off toggle (synced to the user's
    Chrome profile).
  - Content script on `<all_urls>` — auto-scan must run on every site the
    user browses; the extension is a passive reader of visible text only.
- **Remote code**: none. No data collection, no analytics, no network requests.
- **Data usage disclosure**: does not collect or transmit any user data.

## Assets needed (manual)

1. At least 1 screenshot, 1280×800 or 640×400 PNG. Suggested shots:
   popup with a marked-up draft + CERTIFIED SLOP stamp; an article page with
   underlines + hover label showing a rule id.
2. Small promo tile (440×280) — optional but recommended.
3. Marquee promo (1400×560) — optional.

## Review expectations

`<all_urls>` content scripts trigger deeper review; expect a few days.
Justification text above maps each permission to user-visible behavior.
