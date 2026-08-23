const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const extensionFile = (name) => path.join(__dirname, "extension", name);

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
    delete(r) { this.ranges.delete(r); }
  };
  w.CSS = { highlights: new Map() };
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 20, top: 20, bottom: 36, width: 20, height: 16 });

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

  w.eval(fs.readFileSync(extensionFile("engine.js"), "utf8"));
  w.eval(fs.readFileSync(extensionFile("scanner.js"), "utf8"));
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

test("page highlights underline findings without changing page colors", async () => {
  const { w } = boot(`<p style="color: #ddd">This launch marks a pivotal moment.</p>`);
  await tick();

  const style = w.document.getElementById("slop-detector-highlight-style");
  assert.ok(style, "highlight styles should be installed");
  assert.match(style.textContent, /text-decoration:underline wavy #C42B1F 1\.5px/);
  assert.doesNotMatch(style.textContent, /background-color:/);
  assert.doesNotMatch(style.textContent, /(?:^|[;{])color:/);
});

test("badge appears with the finding count", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const badge = w.document.querySelector(".slop-detector-badge-host");
  assert.ok(badge, "badge should exist");
  const n = badge.shadowRoot.querySelector(".n").textContent;
  assert.strictEqual(Number(n), highlightedTexts(w).length);
});

test("hovering a marked phrase shows its rule id", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const p = [...w.document.querySelectorAll("p")].find((el) => /pivotal moment/.test(el.textContent));
  const tn = p.firstChild;
  w.document.caretRangeFromPoint = () => ({ startContainer: tn, startOffset: tn.nodeValue.indexOf("pivotal") });
  w.document.dispatchEvent(new w.MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
  await tick();
  const tip = w.document.querySelector(".slop-detector-tip-host");
  assert.ok(tip, "tooltip should appear on hover");
  assert.match(tip.shadowRoot.textContent, /puffery/);
});

test("hovering unmarked text shows no tooltip", async () => {
  const { w } = boot(`<p>${SLOP_P}</p><p>${HUMAN_P}</p>`);
  await tick();
  const p = [...w.document.querySelectorAll("p")].find((el) => /coffee shop/.test(el.textContent));
  const tn = p.firstChild;
  w.document.caretRangeFromPoint = () => ({ startContainer: tn, startOffset: 0 });
  w.document.dispatchEvent(new w.MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
  await tick();
  assert.strictEqual(w.document.querySelector(".slop-detector-tip-host"), null);
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

test("text edits replace stale highlights and update the badge", async () => {
  const { w } = boot(`<p id="draft">${SLOP_P}</p>`);
  await tick();
  assert.ok(highlightedTexts(w).length > 0);

  w.document.getElementById("draft").firstChild.nodeValue = HUMAN_P;
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(w.document.querySelector(".slop-detector-badge-host"), null);

  w.document.getElementById("draft").firstChild.nodeValue = SLOP_P;
  await tick();
  assert.ok(highlightedTexts(w).some((text) => /pivotal moment/i.test(text)));
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

test("toggling back on re-scans already-seen blocks", async () => {
  const { w, set } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  set("autoScanPages", false);
  await tick();
  set("autoScanPages", true);
  await tick();
  assert.ok(highlightedTexts(w).some((t) => /pivotal moment/i.test(t)), "highlights must be restored");
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
