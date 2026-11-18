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
  /* One highlight per severity, so CSS can color each, and every finding sits in exactly one. Two wavy
     lines on one word tangle, so a minor finding inside a major one goes in "covered", which has no
     style: it draws nothing, yet it still counts and the hover label still lists it. */
  let highlights = null;
  const HIGHLIGHT_NAMES = { major: "slop-major", minor: "slop-minor", covered: "slop-covered" };
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
    /* A node off the page belongs to no block; an element can leave between a mutation and the frame. */
    if (!node?.isConnected) return null;
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

  function isHiddenSubtree(el) {
    return SKIP_TAGS.has(el.tagName.toUpperCase()) || el.isContentEditable || el.getAttribute("aria-hidden") === "true";
  }

  function readableWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        /* Rejecting a hidden element skips everything inside it, so a long <pre> costs one step. */
        if (n.nodeType === Node.ELEMENT_NODE && n.tagName !== "BR") {
          return isHiddenSubtree(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return isReadable(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
  }

  /* Both checks stop at the first hit, so a block with text costs a few steps however large it is.
     The first runs natively and turns away a subtree with no text and no <br> without visiting its
     elements one by one; reading textContent instead would copy a long thread's text every time. */
  function hasReadableText(el) {
    if (isHiddenSubtree(el)) return false;
    const texts = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = texts.nextNode();
    while (text !== null && text.nodeValue === "") text = texts.nextNode();
    if (text === null && !el.querySelector("br")) return false;
    return readableWalker(el).nextNode() !== null;
  }

  /* Blocks known to contain text, their own or a nested block's. A nested block that gains or loses all
     of its text changes where the blocks around it split into paragraphs, so they are read again too. */
  let blocksWithText = new WeakSet();
  /* Blocks with text of their own, outside any nested block. Only these split into paragraphs around
     a nested block, so only these are worth reading again when a nested block's text appears. */
  let blocksOwningText = new WeakSet();

  function markContainsText(block) {
    for (let b = block; b && b !== document.body && !blocksWithText.has(b); b = blockOf(b.parentNode)) {
      blocksWithText.add(b);
    }
  }

  /* Records whether `block` contains text now, and says whether that changed. */
  function textStateChanged(block) {
    const had = blocksWithText.has(block);
    const has = hasReadableText(block);
    if (has) blocksWithText.add(block);
    else blocksWithText.delete(block);
    return had !== has;
  }

  function collectBlocks(root) {
    const blocks = new Map();
    let lastBlock = null;
    const add = (n) => {
      const block = blockOf(n);
      const crossed = lastBlock !== null && lastBlock !== block;
      lastBlock = block;
      if (block) {
        blocksOwningText.add(block);
        markContainsText(block);
      }
      if (!block || processedBlocks.has(block)) return;
      if (!blocks.has(block)) blocks.set(block, []);
      else if (crossed) blocks.get(block).push(GAP);
      blocks.get(block).push(n);
    };

    if (root === looseTextRoot) {
      /* Only the text straight under <body> belongs to the <body> block, so only that is read. An
         element splits it only when it has text of its own, as in a full walk, and that is checked
         only between two runs of loose text, so a page with none costs one step per child. */
      let between = [];
      for (const child of document.body.childNodes) {
        if (isReadable(child)) {
          if (lastBlock !== null && between.some(hasReadableText)) lastBlock = between[0];
          between = [];
          add(child);
        } else if (child.nodeType === Node.ELEMENT_NODE && lastBlock !== null) between.push(child);
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
        range.slopFinding = f;
        const major = f.severity === "major";
        const covered = !major && result.findings.some((g) => g.severity === "major" && g.start <= f.start && g.end >= f.end);
        highlights[major ? "major" : covered ? "covered" : "minor"].add(range);
        allRanges.push(range);
      } catch { /* Nodes can detach between traversal and Range construction. */ }
    }
  }

  function scan(roots) {
    if (!scanEnabled) return;
    for (const root of roots) {
      if (root === looseTextRoot ? !document.body : !root.isConnected) continue;
      for (const [block, nodes] of collectBlocks(root)) lintBlock(block, nodes);
    }
    updateFindingCount();
  }

  function removeRanges(shouldRemove) {
    allRanges = allRanges.filter((range) => {
      if (!shouldRemove(range)) return true;
      for (const h of Object.values(highlights ?? {})) h.delete(range);
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

  /* Hovering an underline names the rule behind it. The label is the one element the extension adds:
     a sibling of <body>, never inside it, so no page content moves, and it is never read as text.
     Its shadow root is closed and it sits in the top layer, so page styles cannot hide or restyle it. */
  let tipHost = null;
  let tipBody = null;

  function ensureTip() {
    if (tipHost?.isConnected) return tipHost;
    tipHost = document.createElement("slop-detector-tip");
    tipHost.setAttribute("popover", "manual");
    tipHost.setAttribute("aria-hidden", "true");
    tipHost.style.cssText = "all: initial !important; position: fixed !important; margin: 0 !important; "
      + "inset: auto !important; pointer-events: none !important; display: none !important;";
    const shadow = tipHost.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      .tip { box-sizing: border-box; max-width: min(360px, calc(100vw - 16px)); padding: 6px 8px;
        background: #23241F; color: #F6F4EE; border-radius: 4px; box-shadow: 0 2px 8px rgb(0 0 0 / .35);
        font: 13px/1.35 system-ui, sans-serif; text-align: start; white-space: normal; }
      .item + .item { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgb(246 244 238 / .2); }
      .rule { display: block; margin-bottom: 2px; color: #F2A79F; font: 700 11px/1.3 ui-monospace, monospace; }
    </style><div class="tip"></div>`;
    tipBody = shadow.querySelector(".tip");
    document.documentElement.appendChild(tipHost);
    return tipHost;
  }

  function hideTip() {
    if (!tipHost || tipHost.style.getPropertyValue("display") === "none") return;
    tipHost.style.setProperty("display", "none", "important");
    try { tipHost.hidePopover?.(); } catch { /* Already hidden. */ }
  }

  function showTip(ranges, anchor) {
    const host = ensureTip();
    tipBody.replaceChildren(...ranges.map(({ slopFinding: f }) => {
      const item = document.createElement("div");
      item.className = "item";
      const rule = document.createElement("span");
      rule.className = "rule";
      rule.textContent = `${f.ruleId} · ${f.severity}`;
      item.append(rule, f.message);
      return item;
    }));
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("visibility", "hidden", "important");
    try { host.showPopover?.(); } catch { /* Already showing. */ }
    const { offsetWidth: tw, offsetHeight: th } = host;
    const x = Math.max(8, Math.min(anchor.left + anchor.width / 2 - tw / 2, window.innerWidth - tw - 8));
    const y = anchor.top - th - 6 >= 8 ? anchor.top - th - 6 : anchor.bottom + 6;
    host.style.setProperty("left", `${Math.round(x)}px`, "important");
    host.style.setProperty("top", `${Math.round(y)}px`, "important");
    host.style.setProperty("visibility", "visible", "important");
  }

  function caretAt(x, y) {
    const p = document.caretPositionFromPoint?.(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
    const r = document.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  /* The caret lands on the nearest character even past the end of a line, so a hit also has to
     lie inside one of the range's line boxes. */
  function rangesAt(x, y) {
    const caret = caretAt(x, y);
    if (!caret || caret.node?.nodeType !== Node.TEXT_NODE) return [];
    const hits = [];
    for (const range of allRanges) {
      if (!range.slopFinding || !range.slopBlock.contains(caret.node)) continue;
      if (!range.isPointInRange(caret.node, caret.offset)) continue;
      for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top - 2 && y <= rect.bottom + 4) {
          hits.push({ range, rect });
          break;
        }
      }
    }
    return hits;
  }

  let hoverPending = false;
  let lastPointer = null;
  document.addEventListener("mousemove", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (hoverPending) return;
    if (!scanEnabled || allRanges.length === 0) {
      hideTip();
      return;
    }
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      const hits = rangesAt(lastPointer.x, lastPointer.y);
      if (hits.length) showTip(hits.map((h) => h.range), hits[0].rect);
      else hideTip();
    });
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", hideTip);
  window.addEventListener("scroll", hideTip, { capture: true, passive: true });

  /* Each mutation names what has to be read again, so a page that streams text into one paragraph
     costs one paragraph per frame, not a walk of the whole document. */
  function ensureObserver() {
    if (observer) return;
    let dirty = new Set();
    let pending = false;
    const observedBody = document.body;
    const looseOrBlock = (block) => (block === document.body ? looseTextRoot : block);
    observer = new MutationObserver((records) => {
      /* Turbo and similar routers swap in a new <body> on navigation, and a <body> taken out and put
         back loses its ranges without changing identity. Either way everything read so far is gone. */
      const bodyArrived = records.some((record) => [...record.addedNodes].includes(document.body));
      if (document.body !== observedBody || bodyArrived) {
        stopScan();
        startScan();
        return;
      }
      const stale = new Set();
      for (const record of records) {
        /* <html> is watched only to see the <body> change. Nothing outside <body> is read. */
        if (record.target === document.documentElement) continue;
        const block = blockOf(record.target);
        if (block) {
          stale.add(block);
          dirty.add(looseOrBlock(block));
        }
        /* An element can come back after a detour off the page, still marked as read and with its
           ranges long gone. Everything that arrives is read as new. */
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          /* What was known about its text may have changed while it was away, so that is forgotten too. */
          for (const el of [node, ...node.querySelectorAll("*")]) {
            stale.add(el);
            blocksWithText.delete(el);
            blocksOwningText.delete(el);
          }
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
        const changed = dirty;
        dirty = new Set();
        const roots = new Set();
        const enclosing = new Set();
        /* A block is checked once per frame. When a thousand rows arrive under one container, the
           container's text is read once, not once per row. */
        const checked = new Set();
        const changedOnce = (block) => {
          if (checked.has(block)) return false;
          checked.add(block);
          return textStateChanged(block);
        };
        for (const root of changed) {
          const owner = root === looseTextRoot ? root : blockOf(root);
          if (!owner) continue;
          roots.add(looseOrBlock(owner));
          if (owner === looseTextRoot || owner === document.body) continue;
          /* The walk climbs while blocks gain or lose all their text, up to the first whose own state
             held, since past that point every split stays where it was. Along the way only a block
             with text of its own is read again: a text-free wrapper has nothing to re-split. */
          for (let inner = owner; changedOnce(inner);) {
            const outer = blockOf(inner.parentNode);
            if (!outer) break;
            if (outer === document.body || blocksOwningText.has(outer)) {
              enclosing.add(outer);
              roots.add(looseOrBlock(outer));
            }
            if (outer === document.body) break;
            inner = outer;
          }
        }
        invalidateBlocks(enclosing);
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
    if (!highlights) {
      highlights = { major: new Highlight(), minor: new Highlight(), covered: new Highlight() };
      highlights.major.priority = 1;
      for (const [severity, name] of Object.entries(HIGHLIGHT_NAMES)) CSS.highlights.set(name, highlights[severity]);
    }
    scan([document.body]);
    /* scan() disables scanning when the extension context is gone; do not attach an observer to a dead context. */
    if (scanEnabled) ensureObserver();
  }

  function stopScan() {
    observer?.disconnect();
    observer = null;
    for (const name of Object.values(HIGHLIGHT_NAMES)) CSS.highlights?.delete(name);
    highlights = null;
    allRanges = [];
    processedBlocks = new WeakSet();
    blocksWithText = new WeakSet();
    blocksOwningText = new WeakSet();
    hideTip();
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

  /* A same-document navigation (pushState, a hash link) clears the badge but keeps the page, so the
     background asks for the count again once the tab settles. */
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "slop:report-count" || sender.id !== chrome.runtime.id) return;
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
