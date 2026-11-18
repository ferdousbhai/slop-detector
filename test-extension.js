"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const extensionFile = (name) => path.join(__dirname, "extension", name);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    dispatch(...args) { return listeners.map((listener) => listener(...args)); },
  };
}

test("background maps scanner counts to tab-scoped action state", async () => {
  const onMessage = event();
  const onUpdated = event();
  const calls = [];
  const chrome = {
    runtime: { onInstalled: event(), onMessage },
    contextMenus: { create() {}, onClicked: event() },
    tabs: { onUpdated, sendMessage: async (tabId, message) => calls.push(["ask", tabId, message.type]) },
    storage: { session: { set: async () => {} } },
    action: {
      setBadgeBackgroundColor: async (details) => calls.push(["color", details]),
      setBadgeText: async (details) => calls.push(["text", details]),
      setTitle: async (details) => calls.push(["title", details]),
      openPopup: async () => {},
    },
  };
  vm.runInNewContext(fs.readFileSync(extensionFile("background.js"), "utf8"), { chrome });

  onMessage.dispatch({ type: "slop:finding-count", count: 12 }, { tab: { id: 7 } });
  await tick();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["color", { tabId: 7, color: "#C42B1F" }],
    ["text", { tabId: 7, text: "12" }],
    ["title", { tabId: 7, title: "Slop Detector: 12 findings" }],
  ]);

  calls.length = 0;
  onUpdated.dispatch(7, { status: "loading" });
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["color", { tabId: 7, color: "#C42B1F" }],
    ["text", { tabId: 7, text: "" }],
    ["title", { tabId: 7, title: "Slop Detector" }],
  ]);

  /* "loading" also fires for pushState; once the tab settles, the page that is still there is asked again. */
  calls.length = 0;
  onUpdated.dispatch(7, { status: "complete" });
  await tick();
  assert.deepEqual(calls, [["ask", 7, "slop:report-count"]]);
});

test("context-menu selections open in the extension popup", async () => {
  const onClicked = event();
  const stored = [];
  const opened = [];
  const chrome = {
    runtime: { onInstalled: event(), onMessage: event() },
    contextMenus: { create() {}, onClicked },
    tabs: { onUpdated: event() },
    storage: { session: { set: async (value) => stored.push(value) } },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setTitle: async () => {},
      openPopup: async (options) => opened.push(options),
    },
  };
  vm.runInNewContext(fs.readFileSync(extensionFile("background.js"), "utf8"), { chrome });

  onClicked.dispatch({ menuItemId: "slop-check-selection", selectionText: "  Great question!  " }, { windowId: 9 });
  await tick();

  assert.deepEqual(JSON.parse(JSON.stringify(stored)), [{ pendingSelection: "Great question!" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ windowId: 9 }]);
});

test("popup consumes an in-memory context-menu selection", async (t) => {
  const html = fs.readFileSync(extensionFile("popup.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const removed = [];
  dom.window.chrome = {
    storage: {
      sync: {
        get: (defaults, callback) => callback(defaults),
        set: () => {},
      },
      session: {
        get: async () => ({ pendingSelection: "Great question! Let us delve into this." }),
        remove: async (key) => removed.push(key),
      },
    },
  };

  dom.window.eval(fs.readFileSync(extensionFile("engine.js"), "utf8"));
  dom.window.eval(fs.readFileSync(extensionFile("popup.js"), "utf8"));
  await tick();

  assert.equal(dom.window.document.getElementById("input").value, "Great question! Let us delve into this.");
  assert.equal(dom.window.document.getElementById("findings").style.display, "block");
  assert.deepEqual(removed, ["pendingSelection"]);
});

test("the extension stays local and keeps its permission set", () => {
  const manifest = JSON.parse(fs.readFileSync(extensionFile("manifest.json"), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["contextMenus", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);

  const network = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(|https?:\/\//;
  for (const name of fs.readdirSync(path.join(__dirname, "extension"))) {
    if (!/\.(?:js|html|css)$/.test(name)) continue;
    const source = fs.readFileSync(extensionFile(name), "utf8");
    assert.doesNotMatch(source, network, `${name} must not reach the network`);
  }
});

test("the popup shows a verdict, a score, the marked text, and why each finding fired", async (t) => {
  const html = fs.readFileSync(extensionFile("popup.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.chrome = {
    storage: {
      sync: { get: (defaults, callback) => callback(defaults), set: () => {} },
      session: { get: async () => ({}), remove: async () => {} },
    },
  };
  dom.window.eval(fs.readFileSync(extensionFile("engine.js"), "utf8"));
  dom.window.eval(fs.readFileSync(extensionFile("popup.js"), "utf8"));
  const doc = dom.window.document;
  const text = "Two job offers. Two kids. This launch marks a pivotal moment for the team.";
  doc.getElementById("input").value = text;
  doc.getElementById("check").click();

  const { findings, label, score } = dom.window.SlopEngine.analyze(text);
  assert.equal(doc.getElementById("stamp").textContent, label);
  assert.equal(doc.getElementById("score").textContent, `${score}/100`);
  assert.equal(doc.getElementById("marked").textContent, text, "marking never changes the text");

  const items = [...doc.querySelectorAll("#findings li")];
  assert.equal(items.length, findings.length);
  findings.forEach((f, i) => {
    assert.ok(items[i].textContent.includes(`${f.ruleId} · ${f.severity}`));
    assert.ok(items[i].textContent.includes(f.message));
    assert.ok(items[i].classList.contains(f.severity));
  });

  const marks = [...doc.querySelectorAll("#marked mark")];
  const pivotal = marks.find((m) => m.textContent.includes("pivotal"));
  assert.ok(pivotal.classList.contains("major"), "a span holding a major finding is marked major");
  assert.match(pivotal.title, /puffery · major/);
  assert.match(pivotal.title, /ai-vocabulary · minor/);
  const fragment = marks.find((m) => m.textContent === "Two job offers.");
  assert.ok(fragment.classList.contains("minor"));
});
