"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const extensionFile = (name) => path.join(__dirname, "extension", name);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function pngDimensions(filename) {
  const png = fs.readFileSync(filename);
  assert.equal(png.toString("ascii", 1, 4), "PNG", `${filename} is not a PNG`);
  assert.equal(png.toString("ascii", 12, 16), "IHDR", `${filename} has no IHDR chunk`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    dispatch(...args) { return listeners.map((listener) => listener(...args)); },
  };
}

test("page content scripts are DOM-mutation-free", () => {
  const manifest = JSON.parse(fs.readFileSync(extensionFile("manifest.json"), "utf8"));
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
  assert.deepEqual(scripts, ["engine.js", "scanner.js"]);
  assert.deepEqual(manifest.content_scripts[0].css, ["highlights.css"]);

  const source = scripts.map((filename) => fs.readFileSync(extensionFile(filename), "utf8")).join("\n");
  assert.doesNotMatch(source, /document\.createElement|\.appendChild\(|\.insertAdjacentHTML\(|\.replaceChildren\(|\.innerHTML\s*=/);
});

test("extension and Store icons have their declared pixel sizes", () => {
  const manifest = JSON.parse(fs.readFileSync(extensionFile("manifest.json"), "utf8"));
  for (const [size, filename] of Object.entries(manifest.icons)) {
    assert.deepEqual(pngDimensions(extensionFile(filename)), [Number(size), Number(size)]);
  }
  assert.deepEqual(
    pngDimensions(path.join(__dirname, "store-assets", "icon-128.png")),
    [128, 128],
  );
});

test("background maps scanner counts to tab-scoped action state", async () => {
  const onMessage = event();
  const onUpdated = event();
  const calls = [];
  const chrome = {
    runtime: { onInstalled: event(), onMessage },
    contextMenus: { create() {}, onClicked: event() },
    tabs: { onUpdated },
    storage: { session: { set: async () => {} } },
    action: {
      setBadgeBackgroundColor: async (details) => calls.push(["color", details]),
      setBadgeText: async (details) => calls.push(["text", details]),
      setTitle: async (details) => calls.push(["title", details]),
      openPopup: async () => {},
    },
  };
  vm.runInNewContext(fs.readFileSync(extensionFile("background.js"), "utf8"), { chrome, Number, Promise });

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
  vm.runInNewContext(fs.readFileSync(extensionFile("background.js"), "utf8"), { chrome, Number, Promise });

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
