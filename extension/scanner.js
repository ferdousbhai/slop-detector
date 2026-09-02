/* CSS Custom Highlights keep annotations out of the host page's DOM. */

(() => {
  "use strict";

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG", "IFRAME"]);
  const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "ARTICLE", "SECTION", "TD", "DD", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const MIN_WORDS = 15;

  let processedBlocks = new WeakSet();
  let scanEnabled = true;
  let observer = null;
  let highlight = null;
  let allRanges = [];
  let lastReportedCount = null;

  const highlightSupported = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;

  function blockOf(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement;
    return el;
  }

  function collectBlocks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        for (let el = n.parentElement; el; el = el.parentElement) {
          if (SKIP_TAGS.has(el.tagName) || el.isContentEditable || el.getAttribute("aria-hidden") === "true") {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const blocks = new Map();
    let n;
    while ((n = walker.nextNode())) {
      const block = blockOf(n);
      if (!block || processedBlocks.has(block)) continue;
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block).push(n);
    }
    return blocks;
  }

  function lintBlock(block, textNodes) {
    let text = "";
    const offsets = [];
    for (const node of textNodes) {
      offsets.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    processedBlocks.add(block);
    if (text.trim().split(/\s+/).length < MIN_WORDS) return;

    const result = globalThis.SlopEngine.analyze(text);
    for (const f of result.findings) {
      if (f.end <= f.start) continue;
      const startEntry = offsets.find((o) => f.start >= o.start && f.start < o.end);
      const endEntry = offsets.find((o) => f.end > o.start && f.end <= o.end);
      if (!startEntry || !endEntry) continue;
      try {
        const range = new Range();
        range.setStart(startEntry.node, f.start - startEntry.start);
        range.setEnd(endEntry.node, f.end - endEntry.start);
        range.slopBlock = block;
        highlight.add(range);
        allRanges.push(range);
      } catch { /* Nodes can detach between traversal and Range construction. */ }
    }
  }

  function scan() {
    if (!scanEnabled) return;
    for (const [block, nodes] of collectBlocks(document.body)) {
      lintBlock(block, nodes);
    }
    updateFindingCount();
  }

  function removeRanges(shouldRemove) {
    allRanges = allRanges.filter((range) => {
      if (!shouldRemove(range)) return true;
      highlight?.delete(range);
      return false;
    });
  }

  function invalidateBlocks(blocks) {
    if (blocks.size === 0) return;
    for (const block of blocks) processedBlocks.delete(block);
    removeRanges((range) => blocks.has(range.slopBlock));
  }

  function reportFindingCount() {
    if (allRanges.length === lastReportedCount) return;
    lastReportedCount = allRanges.length;
    chrome.runtime.sendMessage({ type: "slop:finding-count", count: allRanges.length }).catch(() => {
      /* The extension may be reloading. The next scan reports again. */
      lastReportedCount = null;
    });
  }

  function isLiveRange(range) {
    return range.slopBlock?.isConnected
      && range.startContainer.isConnected
      && range.endContainer.isConnected
      && !range.collapsed;
  }

  function updateFindingCount() {
    removeRanges((range) => !isLiveRange(range));
    reportFindingCount();
  }

  function ensureObserver() {
    if (observer) return;
    let pending = false;
    observer = new MutationObserver((records) => {
      const blocks = new Set();
      for (const record of records) {
        const block = blockOf(record.target);
        if (block) blocks.add(block);
      }
      invalidateBlocks(blocks);
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        scan();
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function startScan() {
    if (!scanEnabled || !highlightSupported) {
      reportFindingCount();
      return;
    }
    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set("slop-mark", highlight);
    }
    scan();
    ensureObserver();
  }

  function stopScan() {
    observer?.disconnect();
    observer = null;
    CSS.highlights?.delete("slop-mark");
    highlight = null;
    allRanges = [];
    processedBlocks = new WeakSet();
    reportFindingCount();
  }

  chrome.storage.sync.get({ autoScanPages: true }, (v) => {
    scanEnabled = !!v.autoScanPages;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startScan, { once: true });
    } else {
      startScan();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if ("autoScanPages" in changes) {
      scanEnabled = !!changes.autoScanPages.newValue;
      if (scanEnabled) startScan();
      else stopScan();
    }
  });
})();
