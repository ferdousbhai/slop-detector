const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const extensionFile = (name) => path.join(__dirname, "extension", name);

const SLOP_P = `I hope this message finds you well. This launch marks a pivotal moment, showcasing our robust and transformative vision for the evolving landscape. Let me know if you have any questions.`;
const HUMAN_P = `We met at the coffee shop around nine and argued about the playoffs for an hour. Nobody changed their mind but the pastries were worth the trip anyway.`;

function boot(html, { autoScanPages = true, supportsHighlights = true, orphaned = false, svgDocument = false } = {}) {
  const dom = new JSDOM(svgDocument ? html : `<!doctype html><body>${html}</body>`, {
    url: "https://example.com/",
    contentType: svgDocument ? "image/svg+xml" : "text/html",
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
  const runtimeListeners = [];
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
      id: "slop-detector-test",
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      sendMessage: (message) => {
        // An orphaned content script gets a synchronous throw, not a rejected promise.
        if (orphaned) throw new Error("Extension context invalidated.");
        messages.push(message);
        return Promise.resolve();
      },
    },
  };

  w.eval(fs.readFileSync(extensionFile("engine.js"), "utf8"));
  w.eval(fs.readFileSync(extensionFile("scanner.js"), "utf8"));
  const fromBackground = (message) => runtimeListeners.forEach((fn) => fn(message, { id: "slop-detector-test" }));
  return { messages, w, observerStats, fromBackground, set: (k, v) => w.chrome.storage.sync.set({ [k]: v }) };
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

test("phrases split across inline elements are still marked", async () => {
  const lead = "everyone here has read the memo already so tell me what do you think";
  const rest = "Great question about the plan today friend and we move on";
  const { w } = boot(`<p><span>${lead}</span> <span>${rest}</span></p>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), ["Great question"]);
});

test("SVG text is skipped", async () => {
  const { messages, w } = boot(`<div><svg><text>${SLOP_P}</text></svg></div>`);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  assert.strictEqual(lastFindingCount(messages), 0);
});

test("an orphaned extension context tears down instead of throwing on every mutation", async () => {
  const { w, observerStats } = boot(`<p id="draft">${SLOP_P}</p>`, { orphaned: true });
  await tick();
  assert.strictEqual(observerStats.created, 0, "no observer may be attached to a dead context");
  assert.strictEqual(highlightedTexts(w).length, 0);

  w.document.getElementById("draft").firstChild.nodeValue = `${HUMAN_P} ${SLOP_P}`;
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
});

test("highlighting leaves page DOM nodes unchanged", async () => {
  const html = `<p style="color: #ddd">This launch marks a pivotal moment.</p>`;
  const { w } = boot(html);
  await tick();

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

test("short headings are checked for coy wording", async () => {
  const { w } = boot(`<h2>What "exhausted" means</h2><h2>Privacy and limitations</h2><p>What "exhausted" means</p>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), [`What "exhausted" means`]);
});

test("a bold label that opens a block is marked", async () => {
  const body = "the page renders before the fonts arrive and nothing shifts once they finally do load";
  const { w } = boot(`<p><strong>Fast startup:</strong> ${body}</p><p>${body} with <strong>Fast startup:</strong> late</p>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), ["Fast startup:"]);
});

test("a <br> separates lines instead of gluing words together", async () => {
  const lead = "we met at the coffee shop around nine and argued about the playoffs and then went home.";
  const { w } = boot(`<p>${lead}<br>In conclusion, the pastries were worth the trip.</p><p>🚀 Launch the site for everyone on the team today<br>✅ Test everything twice before the big release goes out</p>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), ["In conclusion", "🚀 ", "✅ "]);
});

test("text outside the usual block tags is still scanned", async () => {
  const { w } = boot(`<main>${SLOP_P}</main><span>${SLOP_P}</span><table><tr><th>${SLOP_P}</th></tr></table>`);
  await tick();
  const openers = highlightedTexts(w).filter((t) => /finds you well/i.test(t));
  assert.strictEqual(openers.length, 3);
});

test("text in separate inline containers is never read as one sentence", async () => {
  const { w } = boot(`<nav><a href="/">Our pricing is not just fair</a></nav><main><p>${HUMAN_P}</p></main><nav><a href="/x">but also simple enough that everyone on the team can explain it in a minute</a></nav>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), []);
});

test("a block moved elsewhere in the page keeps its highlights", async () => {
  const { messages, w } = boot(`<div id="a"><p id="p">${SLOP_P}</p></div><div id="b"></div>`);
  await tick();
  const before = highlightedTexts(w).length;
  assert.ok(before >= 3);
  w.document.getElementById("b").append(w.document.getElementById("p"));
  await tick();
  assert.strictEqual(highlightedTexts(w).length, before);
  assert.strictEqual(lastFindingCount(messages), before);
});

test("text straight under <body> is scanned, and a block between two runs keeps them apart", async () => {
  const { w } = boot(`${SLOP_P}<p>${HUMAN_P}</p>Our pricing is honestly not just fair for a team this size<p>${HUMAN_P}</p>but also simple enough that everyone can explain it in a minute`);
  await tick();
  const texts = highlightedTexts(w);
  assert.ok(texts.some((t) => /finds you well/i.test(t)));
  assert.ok(!texts.some((t) => /not just/.test(t)), "two loose runs must not join into one sentence");
});

test("a block that leaves the page and returns on a later frame is read again", async () => {
  const { messages, w } = boot(`<div id="host"><section id="s"><p>${SLOP_P}</p><p>${SLOP_P}</p></section></div><div id="other"><p id="clean">${HUMAN_P}</p></div>`);
  await tick();
  const before = highlightedTexts(w).length;
  const section = w.document.getElementById("s");
  section.remove();
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 0);
  w.document.getElementById("other").appendChild(section);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, before);
  assert.strictEqual(lastFindingCount(messages), before);

  const clean = w.document.getElementById("clean");
  clean.remove();
  await tick();
  clean.textContent = SLOP_P;
  w.document.body.appendChild(clean);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, before + before / 2);
});

test("a text change rescans its own block, not the document", async () => {
  const { w } = boot(`<div><p id="stream">${HUMAN_P}</p></div>${`<div><p>${HUMAN_P}</p></div>`.repeat(50)}`);
  await tick();
  const roots = [];
  const createTreeWalker = w.document.createTreeWalker.bind(w.document);
  w.document.createTreeWalker = (root, ...rest) => {
    roots.push(root);
    return createTreeWalker(root, ...rest);
  };
  const stream = w.document.getElementById("stream");
  stream.firstChild.appendData(` ${SLOP_P}`);
  await tick();
  assert.ok(roots.length > 0 && roots.every((root) => root === stream), "only the changed paragraph is walked");
  assert.ok(highlightedTexts(w).some((t) => /finds you well/i.test(t)));
});

test("a restore from the back/forward cache reports the count again", async () => {
  const { messages, w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const sent = messages.length;
  const count = lastFindingCount(messages);
  const show = (persisted) => {
    const event = new w.Event("pageshow");
    event.persisted = persisted;
    w.dispatchEvent(event);
  };
  show(false);
  assert.strictEqual(messages.length, sent);
  show(true);
  assert.strictEqual(messages.length, sent + 1);
  assert.strictEqual(lastFindingCount(messages), count);
});

test("a finding that ends on a <br> is still marked", async () => {
  const { w } = boot(`<p>We shipped the new build on Friday after a long week of testing and review. The catch:<br>it never ran on the old phones that most of our customers still carry.</p>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), ["The catch:"]);
});

test("text on either side of a nested block is not read as one sentence", async () => {
  const { w } = boot(`<div>The launch went fine and it is not just<p>${HUMAN_P}</p> a tool, but a platform for everyone who works here with us.</div>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), []);
});

test("a document with no <body> is left alone", async () => {
  const { messages, w } = boot(`<svg xmlns="http://www.w3.org/2000/svg"><text>${SLOP_P}</text></svg>`, { svgDocument: true });
  await tick();
  assert.strictEqual(w.document.body, null);
  assert.strictEqual(messages.length, 0);
});

test("a page that swaps in a new <body> is scanned again", async () => {
  const { messages, w } = boot(`<p>${HUMAN_P}</p><p>${SLOP_P}</p>`);
  await tick();
  const one = highlightedTexts(w).length;
  assert.ok(one >= 3);
  const body = w.document.createElement("body");
  body.innerHTML = `${w.document.body.innerHTML}<p>${SLOP_P}</p>`;
  w.document.body.replaceWith(body);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, one * 2);
  assert.strictEqual(lastFindingCount(messages), one * 2);
  const later = w.document.createElement("p");
  later.textContent = SLOP_P;
  w.document.body.append(later);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, one * 3);
});

test("an element added to one block and moved into another is read with its new block", async () => {
  const { w } = boot(`<p id="p1">${HUMAN_P}</p><p id="p2">${SLOP_P}</p>`);
  await tick();
  const before = highlightedTexts(w).length;
  const span = w.document.createElement("span");
  span.textContent = "Note: ";
  w.document.getElementById("p1").append(span);
  w.document.getElementById("p2").prepend(span);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, before);
});

test("an unrelated change leaves loose <body> findings as they were", async () => {
  const { w } = boot(`Our pricing is honestly not just fair for a team this size <img src="x.png"> but also simple enough that everyone can explain it in a minute.<p id="p">hi</p>`);
  await tick();
  const before = highlightedTexts(w);
  assert.strictEqual(before.length, 1);
  w.document.getElementById("p").remove();
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), before);
});

test("the background can ask for the count again after a same-document navigation", async () => {
  const { messages, w, fromBackground } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const count = lastFindingCount(messages);
  const sent = messages.length;
  w.history.pushState({}, "", "/next");
  fromBackground({ type: "slop:report-count" });
  assert.strictEqual(messages.length, sent + 1);
  assert.strictEqual(lastFindingCount(messages), count);
});

test("a nested block that gains or loses its text re-splits the block around it", async () => {
  const lead = "The launch went fine and it is not just";
  const tail = " a tool, but a platform for everyone who works here with us.";
  const { w } = boot(`<div>${lead}<p id="slot"></p>${tail}</div>`);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 1, "an empty block does not split the sentence");
  const slot = w.document.getElementById("slot");
  slot.textContent = HUMAN_P;
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), [], "a block with text does");
  slot.textContent = "";
  await tick();
  assert.strictEqual(highlightedTexts(w).length, 1);

  const loose = boot(`Our pricing is honestly not just fair for a team this size <span id="s"></span> but also simple enough that everyone can explain it in a minute.`);
  await tick();
  assert.strictEqual(highlightedTexts(loose.w).length, 1);
  loose.w.document.getElementById("s").textContent = "Pricing";
  await tick();
  assert.deepStrictEqual(highlightedTexts(loose.w), []);
});

test("a <body> taken out and put back in the same task is read again", async () => {
  const { messages, w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const before = highlightedTexts(w).length;
  const body = w.document.body;
  body.remove();
  w.document.documentElement.append(body);
  await tick();
  assert.strictEqual(highlightedTexts(w).length, before);
  assert.strictEqual(lastFindingCount(messages), before);
});

test("a queued rescan survives the <body> being removed before it runs", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const errors = [];
  w.addEventListener("error", (event) => errors.push(event.error));
  w.document.body.append("x");
  await new Promise((resolve) => setImmediate(resolve));
  w.document.body.remove();
  await tick();
  assert.deepStrictEqual(errors, []);
});

test("elements outside <body> are never read", async () => {
  const { w } = boot(`<p>${HUMAN_P}</p>`);
  await tick();
  const outside = w.document.createElement("div");
  outside.textContent = SLOP_P;
  w.document.documentElement.append(outside);
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), []);
});

test("a body-level change on a page of hidden code costs one step per child", async () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `<span>line ${i} of the listing</span>\n`).join("");
  const { w } = boot(`<div id="root"><pre>${lines}</pre></div>`);
  await tick();
  let checks = 0;
  const tagName = Object.getOwnPropertyDescriptor(w.Element.prototype, "tagName");
  Object.defineProperty(w.Element.prototype, "tagName", { get() { checks++; return tagName.get.call(this); }, configurable: true });
  const toast = w.document.createElement("div");
  w.document.body.append(toast);
  await tick();
  Object.defineProperty(w.Element.prototype, "tagName", tagName);
  assert.ok(checks < 200, `${checks} element checks for one appended <div>`);
});

test("a block added and a toast added and removed in one task are both handled", async () => {
  const { messages, w } = boot(`<p>${HUMAN_P}</p>`);
  await tick();
  const errors = [];
  w.addEventListener("error", (event) => errors.push(event.error));
  const added = w.document.createElement("p");
  added.textContent = SLOP_P;
  w.document.body.append(added);
  const toast = w.document.createElement("p");
  toast.textContent = "Saved";
  w.document.body.append(toast);
  toast.remove();
  await tick();
  assert.deepStrictEqual(errors, []);
  const marks = highlightedTexts(w).length;
  assert.ok(marks >= 3);
  assert.strictEqual(lastFindingCount(messages), marks);
});

test("text appearing in a block inside a text-free wrapper re-splits the text around the wrapper", async () => {
  const lead = "Our pricing is honestly not just fair for a team of this size and shape, ";
  const tail = "but also simple enough that everyone on the team can explain it in a minute.";
  const empty = boot(`<div>${lead}<section><p id="p"></p></section>${tail}</div>`);
  await tick();
  assert.strictEqual(highlightedTexts(empty.w).length, 1);
  empty.w.document.getElementById("p").textContent = "Shipping notes";
  await tick();
  assert.deepStrictEqual(highlightedTexts(empty.w), []);

  const full = boot(`<div>${lead}<section><p id="p">Shipping notes</p></section>${tail}</div>`);
  await tick();
  assert.deepStrictEqual(highlightedTexts(full.w), []);
  full.w.document.getElementById("p").textContent = "";
  await tick();
  assert.strictEqual(highlightedTexts(full.w).length, 1);
});

test("an element holding only line breaks splits loose text as it does on a fresh load", async () => {
  const lead = "Key point: the build is fast and nothing shifts at all once fonts do load in time";
  const tail = "delve into the rich tapestry of our robust ecosystem today and tomorrow friends";
  const fresh = boot(`${lead}<li><br><br></li>${tail}`);
  await tick();
  const want = highlightedTexts(fresh.w);
  assert.ok(want.includes("delve"));
  const { w } = boot(`${lead}<li id="li"></li>${tail}`);
  await tick();
  w.document.getElementById("li").append(w.document.createElement("br"));
  await tick();
  assert.deepStrictEqual(highlightedTexts(w).sort(), [...want].sort());
});

test("rows arriving under one container read the container's text once", async () => {
  const rows = (word) => Array.from({ length: 300 }, (_, i) => `<div class="row"><div>${i}</div><div>${word} ${i}</div></div>`).join("");
  const { w } = boot(`<main><div id="g">${rows("name")}</div></main>`);
  await tick();
  let reads = 0;
  const textContent = Object.getOwnPropertyDescriptor(w.Node.prototype, "textContent");
  Object.defineProperty(w.Node.prototype, "textContent", {
    get() { if (this.id === "g") reads++; return textContent.get.call(this); },
    set(value) { textContent.set.call(this, value); },
    configurable: true,
  });
  w.document.getElementById("g").innerHTML = rows("nm");
  await tick();
  Object.defineProperty(w.Node.prototype, "textContent", textContent);
  assert.ok(reads <= 2, `container text read ${reads} times`);
});

test("the first token of a streamed reply does not re-read the whole thread", async () => {
  const turn = (text) => `<div class="turn"><div class="bubble"><div class="md"><p>${text}</p></div></div></div>`;
  const { w } = boot(`<main><div id="thread">${Array.from({ length: 200 }, (_, i) => turn(`${HUMAN_P} ${i}`)).join("")}</div></main>`);
  await tick();
  const thread = w.document.getElementById("thread");
  thread.insertAdjacentHTML("beforeend", turn(""));
  await tick();
  let visited = 0;
  const createTreeWalker = w.document.createTreeWalker.bind(w.document);
  /* jsdom's own selector engine walks without a filter; only the scanner's walks are counted. */
  w.document.createTreeWalker = (root, what, filter) => createTreeWalker(root, what, filter && {
    acceptNode(node) {
      visited++;
      return filter.acceptNode(node);
    },
  });
  thread.lastElementChild.querySelector("p").textContent = "Sure";
  await tick();
  assert.ok(visited < 50, `${visited} nodes visited for one token in a thread of 200 turns`);
});

test("a block emptied while off the page and refilled after it returns re-splits its surroundings", async () => {
  const { w } = boot(`<div id="o">Our pricing is honestly not just fair for a team this size <span id="slot"></span> but also simple enough that everyone can explain it in a minute.</div><div id="park"><div id="y"><p id="p">Saved draft text here.</p></div></div>`);
  await tick();
  const y = w.document.getElementById("y");
  const p = w.document.getElementById("p");
  y.remove();
  await tick();
  p.textContent = "";
  await tick();
  w.document.getElementById("slot").append(y);
  await tick();
  p.textContent = "Loaded.";
  await tick();
  assert.deepStrictEqual(highlightedTexts(w), []);
});

test("a body-level change beside a large text-free subtree does not visit that subtree", async () => {
  const grid = "<div><div><span></span></div></div>".repeat(1000);
  const { w } = boot(`\n<header><p>${HUMAN_P}</p></header>\n<div id="big">${grid}</div>\n<footer><p>${HUMAN_P}</p></footer>\n`);
  await tick();
  let visited = 0;
  const createTreeWalker = w.document.createTreeWalker.bind(w.document);
  /* Only walks with a filter call back into the scanner per node; jsdom's own and the native pre-check do not. */
  w.document.createTreeWalker = (root, what, filter) => createTreeWalker(root, what, filter && {
    acceptNode(node) {
      visited++;
      return filter.acceptNode(node);
    },
  });
  const tip = w.document.createElement("div");
  tip.textContent = "tip";
  w.document.body.append(tip);
  await tick();
  assert.ok(visited < 100, `${visited} nodes visited for one appended tooltip`);
});

test("hovering an underline shows the rule and why it fired", async () => {
  const { w } = boot(`<p>${SLOP_P}</p>`);
  await tick();
  const shadows = new WeakMap();
  const attachShadow = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (init) {
    const root = attachShadow.call(this, init);
    shadows.set(this, root);
    return root;
  };
  const range = [...w.CSS.highlights.get("slop-mark").ranges].find((r) => /pivotal moment/i.test(r.toString()));
  assert.ok(range, "the puffery should be marked");
  // jsdom has no layout: put the marked phrase at a known box and point the caret into it.
  const box = { left: 100, right: 200, top: 50, bottom: 70, width: 100, height: 20 };
  w.Range.prototype.getClientRects = function () { return this === range ? [box] : []; };
  w.document.caretPositionFromPoint = (x) => ({ offsetNode: range.startContainer, offset: range.startOffset + (x > 150 ? 1 : 0) });
  const hover = async (x, y) => {
    w.document.dispatchEvent(new w.MouseEvent("mousemove", { clientX: x, clientY: y }));
    await tick();
  };
  const tip = () => w.document.querySelector("slop-detector-tip");

  await hover(150, 60);
  assert.ok(tip(), "a label should appear");
  assert.strictEqual(tip().parentNode, w.document.documentElement, "the label sits outside <body>");
  assert.strictEqual(tip().style.getPropertyValue("display"), "block");
  assert.strictEqual(tip().shadowRoot, null, "the page cannot reach into the label");
  const label = shadows.get(tip()).querySelector(".tip").textContent;
  assert.match(label, /^puffery · /, `label should name the rule, got: ${label}`);
  assert.ok(label.includes(range.slopFinding.message), "label should say why the phrase was flagged");

  await hover(150, 300);
  assert.strictEqual(tip().style.getPropertyValue("display"), "none", "moving off the underline hides it");
  assert.strictEqual(w.document.body.querySelector("slop-detector-tip"), null, "<body> is never touched");
});
