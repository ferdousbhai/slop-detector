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
  /* Stands for "the loose text under <body>" in a set of roots to rescan, where <body> itself would mean the whole page. */
  const looseTextRoot = Symbol("loose body text");

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

  /* A <br> is the only element collected: it stands for the line break the flattened text needs.
     Whitespace-only text nodes are kept so inline siblings stay word-separated in lintBlock. */
  function isReadable(n) {
    if (n.nodeType === Node.ELEMENT_NODE ? n.tagName !== "BR" : n.nodeType !== Node.TEXT_NODE || !n.nodeValue) return false;
    for (let el = n.parentElement; el; el = el.parentElement) {
      /* tagName is uppercase only for HTML-namespaced elements; SVG reports its authored case. */
      if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.isContentEditable || el.getAttribute("aria-hidden") === "true") {
        return false;
      }
    }
    return true;
  }

  /* GAP marks where another block's text sits between two nodes of this one. The text on either side
     is two paragraphs, and no finding may reach across the block in between. */
  const GAP = null;

  function readableWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE && n.tagName !== "BR") return NodeFilter.FILTER_SKIP;
        return isReadable(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
  }

  function collectBlocks(root) {
    const blocks = new Map();
    let lastBlock = null;
    const add = (n) => {
      const block = blockOf(n);
      const crossed = lastBlock !== null && lastBlock !== block;
      lastBlock = block;
      if (!block || processedBlocks.has(block)) return;
      if (!blocks.has(block)) blocks.set(block, []);
      else if (crossed) blocks.get(block).push(GAP);
      blocks.get(block).push(n);
    };

    if (root === looseTextRoot) {
      /* Only the text straight under <body> belongs to the <body> block, so only that is read. */
      for (const child of document.body.childNodes) {
        /* An element splits the loose text only when it has text of its own, as in a full walk. */
        if (isReadable(child)) add(child);
        else if (child.nodeType === Node.ELEMENT_NODE && readableWalker(child).nextNode()) lastBlock = child;
      }
      return blocks;
    }

    const walker = readableWalker(root);
    let n;
    while ((n = walker.nextNode())) add(n);
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
    for (const node of textNodes) {
      if (node === GAP || node.nodeType === Node.ELEMENT_NODE) {
        text += node === GAP ? "\n\n" : "\n";
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
      /* A match can end on the line break that stands for a <br>, which no text node owns. */
      const endEntry = offsets.find((o) => f.end > o.start && f.end <= o.end)
        ?? offsets.findLast((o) => o.end < f.end && o.end > f.start);
      if (!startEntry || !endEntry) continue;
      try {
        const range = new Range();
        range.setStart(startEntry.node, f.start - startEntry.start);
        range.setEnd(endEntry.node, Math.min(f.end, endEntry.end) - endEntry.start);
        range.slopBlock = block;
        highlight.add(range);
        allRanges.push(range);
      } catch { /* Nodes can detach between traversal and Range construction. */ }
    }
  }

  function scan(roots) {
    if (!scanEnabled) return;
    for (const root of roots) {
      if (root !== looseTextRoot && !root.isConnected) continue;
      for (const [block, nodes] of collectBlocks(root)) lintBlock(block, nodes);
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

  /* Each mutation names what has to be read again, so a page that streams text into one paragraph
     costs one paragraph per frame, not a walk of the whole document. */
  function ensureObserver() {
    if (observer) return;
    let dirty = new Set();
    let pending = false;
    const observedBody = document.body;
    observer = new MutationObserver((records) => {
      /* Turbo and similar routers swap in a new <body> on navigation. Everything read so far is gone. */
      if (document.body !== observedBody) {
        stopScan();
        startScan();
        return;
      }
      const stale = new Set();
      for (const record of records) {
        const block = blockOf(record.target);
        if (block) {
          stale.add(block);
          dirty.add(block === document.body ? looseTextRoot : block);
        }
        /* An element can come back after a detour off the page, still marked as read and with its
           ranges long gone. Everything that arrives is read as new. */
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          stale.add(node);
          for (const el of node.querySelectorAll("*")) stale.add(el);
          dirty.add(node);
        }
      }
      invalidateBlocks(stale);
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        /* A node is read through the block it sits in now, which may not be where it first arrived.
           Reading the node alone would lint its block from part of its text and mark it as read. */
        const roots = new Set();
        for (const root of dirty) {
          const owner = root === looseTextRoot ? root : blockOf(root);
          if (owner) roots.add(owner === document.body ? looseTextRoot : owner);
        }
        dirty = new Set();
        scan(roots);
      });
    });
    if (observedBody) observer.observe(observedBody, { childList: true, characterData: true, subtree: true });
    observer.observe(document.documentElement, { childList: true });
  }

  function startScan() {
    if (!scanEnabled || !highlightSupported) {
      reportFindingCount();
      return;
    }
    /* With no <body> there is nothing to read yet, but one may still be added. A standalone SVG or XML
       document never gets one, and is only watched. */
    if (!document.body) {
      ensureObserver();
      return;
    }
    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set("slop-mark", highlight);
    }
    scan([document.body]);
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

  /* A page restored from the back/forward cache keeps its highlights, but the badge was cleared when
     the tab navigated away and this script does not run again. */
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    lastReportedCount = null;
    reportFindingCount();
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
