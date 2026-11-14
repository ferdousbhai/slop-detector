/* CSS Custom Highlights keep annotations out of the host page's DOM. */

(() => {
  "use strict";

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG", "IFRAME"]);
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "BLOCKQUOTE", "ARTICLE", "SECTION", "MAIN", "HEADER", "FOOTER", "ASIDE",
    "TD", "TH", "DD", "DT", "FIGCAPTION", "SUMMARY", "H1", "H2", "H3", "H4", "H5", "H6",
  ]);
  const MIN_WORDS = 15;
  /* A heading is short by nature, and the heading rule reads nothing but its wording. */
  const MIN_HEADING_WORDS = 3;
  const HEADING_TAG = /^H[1-6]$/;
  const BOLD_TAGS = new Set(["STRONG", "B"]);

  let processedBlocks = new WeakSet();
  let scanEnabled = true;
  let observer = null;
  let highlight = null;
  let allRanges = [];
  let lastReportedCount = null;
  let messagingAvailable = true;

  const highlightSupported = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;

  /* Text with no block ancestor belongs to its outermost element under <body>, so one <nav> or <span>
     is one block and unrelated parts of the page are never read as one sentence. Text that sits
     straight under <body> has no such element, and <body> itself stands in. */
  function blockOf(node) {
    let outermost = null;
    for (let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; el; el = el.parentElement) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      if (el === document.body) return outermost ?? el;
      outermost = el;
    }
    return null;
  }

  function collectBlocks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        /* A <br> is the only element collected: it stands for the line break the flattened text needs. */
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.tagName !== "BR") return NodeFilter.FILTER_SKIP;
        } else if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        /* Whitespace-only text nodes are kept so inline siblings stay word-separated in lintBlock. */
        for (let el = n.parentElement; el; el = el.parentElement) {
          /* tagName is uppercase only for HTML-namespaced elements; SVG reports its authored case. */
          if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.isContentEditable || el.getAttribute("aria-hidden") === "true") {
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

  /* Flattened text loses markup, so the label rule needs to be told where a leading bold run ends. */
  function boldLeadLength(block, offsets) {
    let end = 0;
    for (const { node, end: nodeEnd } of offsets) {
      if (!node.nodeValue.trim()) {
        if (end === 0) continue;
        break;
      }
      let bold = false;
      for (let el = node.parentElement; el && el !== block; el = el.parentElement) {
        if (BOLD_TAGS.has(el.tagName)) bold = true;
      }
      if (!bold) break;
      end = nodeEnd;
    }
    return end;
  }

  function lintBlock(block, textNodes) {
    let text = "";
    const offsets = [];
    let previous = null;
    for (const node of textNodes) {
      /* Loose text on either side of a block is two paragraphs, not one. */
      if (block === document.body && previous && node.previousSibling !== previous) text += "\n\n";
      previous = node;
      if (node.nodeType === Node.ELEMENT_NODE) {
        text += "\n";
        continue;
      }
      offsets.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    processedBlocks.add(block);
    const heading = HEADING_TAG.test(block.tagName);
    if (text.trim().split(/\s+/).length < (heading ? MIN_HEADING_WORDS : MIN_WORDS)) return;

    const result = globalThis.SlopEngine.analyze(text, { heading, boldLead: boldLeadLength(block, offsets) });
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

  /* Moving a block collapses its ranges but leaves its text alone, so no mutation names it. A range
     that died inside a block still on the page means that block has to be read again. */
  function releaseMovedBlocks() {
    const moved = new Set();
    for (const range of allRanges) {
      if (!isLiveRange(range) && range.slopBlock?.isConnected) moved.add(range.slopBlock);
    }
    invalidateBlocks(moved);
  }

  function scan() {
    if (!scanEnabled) return;
    releaseMovedBlocks();
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
    if (!messagingAvailable || allRanges.length === lastReportedCount) return;
    lastReportedCount = allRanges.length;
    try {
      chrome.runtime.sendMessage({ type: "slop:finding-count", count: allRanges.length }).catch(() => {
        /* The extension may be reloading. The next scan reports again. */
        lastReportedCount = null;
      });
    } catch {
      /* An orphaned content script throws synchronously, so tear down once instead of on every mutation.
         stopScan's own report call returns on the flag above and cannot re-enter this throw. */
      messagingAvailable = false;
      scanEnabled = false;
      stopScan();
    }
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
    /* scan() disables scanning when the extension context is gone; do not attach an observer to a dead context. */
    if (scanEnabled) ensureObserver();
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
