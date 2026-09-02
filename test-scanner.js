const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const extensionFile = (name) => path.join(__dirname, "extension", name);

const SLOP_P = `I hope this message finds you well. This launch marks a pivotal moment, showcasing our robust and transformative vision for the evolving landscape. Let me know if you have any questions.`;
const HUMAN_P = `We met at the coffee shop around nine and argued about the playoffs for an hour. Nobody changed their mind but the pastries were worth the trip anyway.`;

function boot(html, { autoScanPages = true, supportsHighlights = true } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: "https://example.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;

  const observerStats = { created: 0, disconnected: 0 };
  const NativeMutationObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) {
      super(callback);
      observerStats.created++;
    }

    disconnect() {
      observerStats.disconnected++;
      super.disconnect();
    }
  };

  // jsdom does not implement the CSS Custom Highlight API.
  if (supportsHighlights) {
    w.Highlight = class {
      constructor() { this.ranges = new Set(); }
      add(r) { this.ranges.add(r); }
      delete(r) { this.ranges.delete(r); }
    };
    w.CSS = { highlights: new Map() };
  }

  const listeners = [];
  const messages = [];
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
    runtime: {
      sendMessage: (message) => {
        messages.push(message);
        return Promise.resolve();
      },
    },
  };

  w.eval(fs.readFileSync(extensionFile("engine.js"), "utf8"));
  w.eval(fs.readFileSync(extensionFile("scanner.js"), "utf8"));
  return { messages, w, observerStats, set: (k, v) => w.chrome.storage.sync.set({ [k]: v }) };
}

const tick = () => new Promise((r) => setTimeout(r, 60));

function highlightedTexts(w) {
  const hl = w.CSS.highlights.get("slop-mark");
  if (!hl) return [];
  return [...hl.ranges].map((r) => r.toString());
}

function lastFindingCount(messages) {
  return messages.filter((message) => message.type === "slop:finding-count").at(-1)?.count;
}

test("slop paragraph gets underline ranges on the exact phrases", async () => {
  const { w } = boot(`<p>${SLOP_P}</p><p>${HUMAN_P}</p>`);
  await tick();
  const texts = highlightedTexts(w);
  assert.ok(texts.length >= 3, `expected several ranges, got ${texts.length}`);
  assert.ok(texts.some((t) => /finds you well/i.test(t)), "opener should be marked");
  assert.ok(texts.some((t) => /pivotal moment/i.test(t)), "puffery should be marked");
  assert.ok(!texts.some((t) => /coffee shop|playoffs|pastries/i.test(t)), "human text must be untouched");
});

test("highlight styling is packaged without adding page DOM nodes", async () => {
  const html = `<p style="color: #ddd">This launch marks a pivotal moment.</p>`;
  const { w } = boot(html);
  await tick();

  const css = fs.readFileSync(extensionFile("highlights.css"), "utf8");
  assert.match(css, /text-decoration:\s*underline wavy #C42B1F 1\.5px/);
  assert.doesNotMatch(css, /background-color:/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*color:/);
  assert.strictEqual(w.document.body.innerHTML, html);
});

test("reports the finding count for the toolbar badge", async () => {
  const { messages, w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  assert.strictEqual(lastFindingCount(messages), highlightedTexts(w).length);
});

test("clean page reports zero and has no highlights", async () => {
  const { messages, w } = boot(`<p>${HUMAN_P}</p>`);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(lastFindingCount(messages), 0);
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

test("removing a marked block clears stale highlights and toolbar count", async () => {
  const { messages, w } = boot(`<div id="feed"><p id="draft">${SLOP_P}</p></div>`);
  await tick();
  assert.ok(highlightedTexts(w).length > 0);

  w.document.getElementById("draft").remove();
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(lastFindingCount(messages), 0);
});

test("text edits replace stale highlights and update the toolbar count", async () => {
  const { messages, w } = boot(`<p id="draft">${SLOP_P}</p>`);
  await tick();
  assert.ok(highlightedTexts(w).length > 0);

  w.document.getElementById("draft").firstChild.nodeValue = HUMAN_P;
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(lastFindingCount(messages), 0);

  w.document.getElementById("draft").firstChild.nodeValue = SLOP_P;
  await tick();
  assert.ok(highlightedTexts(w).some((text) => /pivotal moment/i.test(text)));
});

test("toggle off clears highlights and the toolbar count", async () => {
  const { messages, w, observerStats, set } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  assert.ok(highlightedTexts(w).length > 0);
  assert.strictEqual(observerStats.created, 1);
  set("autoScanPages", false);
  await tick();
  assert.strictEqual(observerStats.disconnected, 1);
  assert.strictEqual(w.CSS.highlights.get("slop-mark"), undefined);
  assert.strictEqual(lastFindingCount(messages), 0);
});

test("toggling back on re-scans already-seen blocks", async () => {
  const { w, observerStats, set } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  set("autoScanPages", false);
  await tick();
  set("autoScanPages", true);
  await tick();
  assert.strictEqual(observerStats.created, 2);
  assert.ok(highlightedTexts(w).some((t) => /pivotal moment/i.test(t)), "highlights must be restored");
});

test("starts disabled when setting is off", async () => {
  const { messages, w, observerStats } = boot(`<p>${SLOP_P}</p>`, { autoScanPages: false });
  await tick();
  assert.strictEqual(observerStats.created, 0);
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(lastFindingCount(messages), 0);
});

test("does not observe pages without CSS highlight support", async () => {
  const { messages, observerStats } = boot(`<p>${SLOP_P}</p>`, { supportsHighlights: false });
  await tick();
  assert.strictEqual(observerStats.created, 0);
  assert.strictEqual(lastFindingCount(messages), 0);
});

test("nothing is ever hidden, even certified slop in a feed", async () => {
  const slop = `I hope this finds you well! This launch marks a pivotal moment, showcasing our robust vision. It's not just a product, it's a game-changer. Let me know if you have any questions!`;
  const feed = `<article><p>${slop}</p></article>`.repeat(4) + `<article data-testid="tweet"><div data-testid="tweetText">${slop}</div></article>`;
  const { w } = boot(feed);
  await tick();
  for (const a of w.document.querySelectorAll("article")) {
    assert.notStrictEqual(a.style.display, "none", "no article may be hidden");
  }
  assert.strictEqual(w.document.body.querySelectorAll("[class^='slop-detector-']").length, 0, "no extension UI may be injected");
  assert.ok(highlightedTexts(w).length > 0, "slop still underlined");
});
