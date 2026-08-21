const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const SLOP_P = `I hope this message finds you well. This launch marks a pivotal moment, showcasing our robust and transformative vision for the evolving landscape. Let me know if you have any questions.`;
const HUMAN_P = `We met at the coffee shop around nine and argued about the playoffs for an hour. Nobody changed their mind but the pastries were worth the trip anyway.`;

function boot(html, { autoScanPages = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: "https://example.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;

  // --- stub CSS Custom Highlight API (jsdom lacks it) ---
  w.Highlight = class {
    constructor() { this.ranges = new Set(); }
    add(r) { this.ranges.add(r); }
  };
  w.CSS = { highlights: new Map() };

  // --- stub chrome.storage ---
  const listeners = [];
  const store = { autoScanPages };
  w.chrome = {
    storage: {
      sync: {
        get: (defaults, cb) => cb({ ...defaults, ...store }),
        set: (v) => {
          const changes = {};
          for (const k of Object.keys(v)) { changes[k] = { newValue: v[k] }; store[k] = v[k]; }
          listeners.forEach((fn) => fn(changes, "sync"));
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: { onMessage: { addListener: () => {} } },
  };

  w.eval(fs.readFileSync("extension/engine.js", "utf8"));
  w.eval(fs.readFileSync("extension/scanner.js", "utf8"));
  return { dom, w, set: (k, v) => w.chrome.storage.sync.set({ [k]: v }) };
}

const tick = () => new Promise((r) => setTimeout(r, 60));

function highlightedTexts(w) {
  const hl = w.CSS.highlights.get("slop-mark");
  if (!hl) return [];
  return [...hl.ranges].map((r) => r.toString());
}

test("slop paragraph gets underline ranges on the exact phrases", async () => {
  const { w } = boot(`<p>${SLOP_P}</p><p>${HUMAN_P}</p>`);
  await tick();
  const texts = highlightedTexts(w);
  assert.ok(texts.length >= 3, `expected several ranges, got ${texts.length}`);
  assert.ok(texts.some((t) => /finds you well/i.test(t)), "opener should be marked");
  assert.ok(texts.some((t) => /pivotal moment/i.test(t)), "puffery should be marked");
  // No range should come from the human paragraph
  assert.ok(!texts.some((t) => /coffee shop|playoffs|pastries/i.test(t)), "human text must be untouched");
});

test("badge appears with the finding count", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const badge = w.document.querySelector(".slop-detector-badge-host");
  assert.ok(badge, "badge should exist");
  const n = badge.shadowRoot.querySelector(".n").textContent;
  assert.strictEqual(Number(n), highlightedTexts(w).length);
});

test("clean page shows no badge and no highlights", async () => {
  const { w } = boot(`<p>${HUMAN_P}</p>`);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(w.document.querySelector(".slop-detector-badge-host"), null);
});

test("short blocks and code blocks are skipped", async () => {
  const { w } = boot(`<p>delve delve delve</p><pre>I hope this message finds you well and this marks a pivotal moment for the codebase honestly</pre>`);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
});

test("dynamically inserted slop is caught by the observer", async () => {
  const { w } = boot(`<div id="feed"><p>${HUMAN_P}</p></div>`);
  await tick();
  w.document.getElementById("feed").insertAdjacentHTML("beforeend", `<p>${SLOP_P}</p>`);
  await tick();
  assert.ok(highlightedTexts(w).some((t) => /pivotal moment/i.test(t)));
});

test("toggle off clears highlights and badge", async () => {
  const { w, set } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  assert.ok(highlightedTexts(w).length > 0);
  set("autoScanPages", false);
  await tick();
  assert.strictEqual(w.CSS.highlights.get("slop-mark"), undefined);
  assert.strictEqual(w.document.querySelector(".slop-detector-badge-host"), null);
});

test("starts disabled when setting is off", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`, { autoScanPages: false });
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
});

test("nothing is ever hidden, even certified slop in a feed", async () => {
  const slop = `I hope this finds you well! This launch marks a pivotal moment, showcasing our robust vision. It's not just a product, it's a game-changer. Let me know if you have any questions!`;
  const feed = `<article><p>${slop}</p></article>`.repeat(4) + `<article data-testid="tweet"><div data-testid="tweetText">${slop}</div></article>`;
  const { w } = boot(feed);
  await tick();
  for (const a of w.document.querySelectorAll("article")) {
    assert.notStrictEqual(a.style.display, "none", "no article may be hidden");
  }
  assert.strictEqual(w.document.querySelectorAll(".slop-detector-bar-host").length, 0, "no hide bars");
  assert.ok(highlightedTexts(w).length > 0, "slop still underlined");
});
