# Slop Detector

Red-pen linting for AI-flavored writing, as a browser extension. Inspired by
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)'s lint-rule
architecture, with patterns drawn from the
[unslop](https://www.skills.sh/cursor/plugins/unslop) skill and
[petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop).

## Features

- **Auto-scan** — every page's visible text is segmented into blocks and
  linted automatically (Google-Translate style). Findings get a yellow
  highlight + wavy red underline via the CSS Custom Highlight API, so the
  page's DOM is never modified. A badge shows the finding count; click it
  to cycle through findings. Nothing is ever hidden or removed.
- **Popup checker** — paste any draft, get highlighted findings and a
  rubber-stamp verdict (READS HUMAN / SUSPICIOUS / CERTIFIED SLOP).
- **Right-click** — "Check selection for slop" on any selected text.

## How it works

`extension/engine.js` is a linter for prose: ~17 rule categories
(~120 patterns) covering chatbot phrases, puffery, vague attribution,
binary contrasts, throat-clearing, AI vocabulary, em-dash density,
hedging ratios, uniform sentence rhythm, and more. Each rule reports
`{ ruleId, severity, start, end, message }` spans, and a scoring layer
aggregates them to 0–100. Pure pattern matching — fast, explainable,
no ML, no network calls, everything runs locally.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder

## Development

```bash
npm install     # jsdom, for DOM tests
npm test        # engine + scanner test suites
```

## Limitations

- Rule-based detection flags *style*, not authorship. A clean score means
  no stylistic fingerprints — it cannot prove who or what wrote a text.
- CSS Custom Highlight API requires Chrome 105+ (scanner no-ops on older).
