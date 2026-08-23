/* Universal auto-scan, Google-Translate style. One consistent behavior on
   every site: walk visible text, segment into blocks, lint each, and
   underline findings via the CSS Custom Highlight API. Nothing is ever
   hidden or removed from the page. */

(() => {
  "use strict";

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG", "IFRAME"]);
  const BLOCK_TAGS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "ARTICLE", "SECTION", "TD", "DD", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6"]);
  const MIN_WORDS = 15;

  // ---------- state ----------

  let processedBlocks = new WeakSet();
  let scanEnabled = true;
  let observer = null;
  let highlight = null;
  let allRanges = [];
  let cycleIndex = 0;
  let badge = null;
  let badgeCount = null;
  let tip = null;
  let tipText = null;

  const highlightSupported = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;

  // ---------- block discovery ----------

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

  // ---------- underline linting ----------

  function lintBlock(block, textNodes) {
    if (!scanEnabled || !highlightSupported) return 0;
    let text = "";
    const offsets = [];
    for (const node of textNodes) {
      offsets.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    if (text.trim().split(/\s+/).length < MIN_WORDS) {
      processedBlocks.add(block);
      return 0;
    }
    processedBlocks.add(block);

    const result = globalThis.SlopEngine.analyze(text);
    let added = 0;
    for (const f of result.findings) {
      if (f.end <= f.start) continue;
      const startEntry = offsets.find((o) => f.start >= o.start && f.start < o.end);
      const endEntry = offsets.find((o) => f.end > o.start && f.end <= o.end);
      if (!startEntry || !endEntry) continue;
      try {
        const range = new Range();
        range.setStart(startEntry.node, f.start - startEntry.start);
        range.setEnd(endEntry.node, f.end - endEntry.start);
        range.slopRule = f.ruleId;
        range.slopBlock = block;
        highlight.add(range);
        allRanges.push(range);
        added++;
      } catch { /* detached node; skip */ }
    }
    return added;
  }

  function scan(root) {
    if (!scanEnabled) return;
    let added = 0;
    for (const [block, nodes] of collectBlocks(root instanceof Element ? root : document.body)) {
      added += lintBlock(block, nodes);
    }
    if (added > 0 || badge) updateBadge();
  }

  function invalidateBlock(block) {
    if (!block) return;
    processedBlocks.delete(block);
    allRanges = allRanges.filter((range) => {
      if (range.slopBlock !== block) return true;
      highlight?.delete(range);
      return false;
    });
  }

  // ---------- badge ----------

  function updateBadge() {
    // Drop ranges whose text was removed from the DOM so the count and
    // cycling stay accurate on long-lived pages.
    allRanges = allRanges.filter((range) => {
      if (range.startContainer.isConnected) return true;
      highlight?.delete(range);
      return false;
    });
    if (allRanges.length === 0) {
      badge?.remove();
      badge = null;
      return;
    }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "slop-detector-badge-host";
      const shadow = badge.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          .pill {
            all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483646;
            display: flex; align-items: center; gap: 8px;
            background: #F6F4EE; border: 1.5px solid #23241F; border-radius: 3px;
            box-shadow: 3px 3px 0 rgba(35,36,31,.85);
            padding: 7px 11px; cursor: pointer;
            font: 700 11px/1 "Courier New", monospace; letter-spacing: .08em; color: #23241F;
          }
          .n { color: #C42B1F; }
          .x { border: none; background: none; cursor: pointer; font: 700 12px/1 monospace; color: #55564F; padding: 0 0 0 2px; }
        </style>
        <div class="pill" role="button" title="Click to jump between findings">
          <span><span class="n">0</span> SLOP MARKS</span>
          <button class="x" aria-label="Dismiss" title="Dismiss">✕</button>
        </div>`;
      badgeCount = shadow.querySelector(".n");
      shadow.querySelector(".pill").addEventListener("click", (e) => {
        if (e.target.closest(".x")) return;
        if (!allRanges.length) return;
        const r = allRanges[cycleIndex % allRanges.length];
        cycleIndex++;
        r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      shadow.querySelector(".x").addEventListener("click", () => badge.remove());
      document.documentElement.appendChild(badge);
    }
    if (!badge.isConnected) return;
    badgeCount.textContent = String(allRanges.length);
  }

  // ---------- hover rule label ----------

  function hideTip() {
    tip?.remove();
    tip = null;
  }

  function showTip(range) {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "slop-detector-tip-host";
      Object.assign(tip.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        zIndex: "2147483645",
        pointerEvents: "none",
        width: "max-content",
        maxWidth: "min(340px, calc(100vw - 16px))",
      });
      const shadow = tip.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          .tip {
            all: initial;
            background: #23241F; color: #F6F4EE; border-radius: 3px;
            padding: 4px 7px;
            font: 700 10px/1 "Courier New", monospace; letter-spacing: .08em;
          }
        </style>
        <div class="tip"></div>`;
      tipText = shadow.querySelector(".tip");
      document.documentElement.appendChild(tip);
    }
    if (!tip.isConnected) return;
    tipText.textContent = range.slopRule;
    const r = range.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    let y = r.top - th - 6;
    if (y < 8) y = r.bottom + 6;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  }

  function caretPointAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const p = document.caretPositionFromPoint?.(x, y);
    return p ? { startContainer: p.offsetNode, startOffset: p.offset } : null;
  }

  let pendingHover = false;
  document.addEventListener("mousemove", (e) => {
    if (!scanEnabled || !allRanges.length) { hideTip(); return; }
    if (pendingHover) return;
    pendingHover = true;
    requestAnimationFrame(() => {
      pendingHover = false;
      const pos = caretPointAt(e.clientX, e.clientY);
      const hit = pos && pos.startContainer.nodeType === Node.TEXT_NODE
        ? allRanges.find((r) => r.slopRule && r.isPointInRange(pos.startContainer, pos.startOffset))
        : null;
      if (hit) showTip(hit); else hideTip();
    });
  });
  document.documentElement.addEventListener("mouseleave", hideTip);
  window.addEventListener("scroll", hideTip, { capture: true, passive: true });

  // ---------- lifecycle ----------

  function ensureObserver() {
    if (observer) return;
    let pending = false;
    observer = new MutationObserver((records) => {
      for (const record of records) invalidateBlock(blockOf(record.target));
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        scan(document.body);
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function startScan() {
    if (!highlightSupported) return;
    if (!highlight) {
      highlight = new Highlight();
      CSS.highlights.set("slop-mark", highlight);
    }
    if (!document.getElementById("slop-detector-highlight-style")) {
      const style = document.createElement("style");
      style.id = "slop-detector-highlight-style";
      style.textContent =
        "::highlight(slop-mark){text-decoration:underline wavy #C42B1F 1.5px;}";
      document.documentElement.appendChild(style);
    }
  }

  function stopScan() {
    CSS.highlights?.delete("slop-mark");
    highlight = null;
    allRanges = [];
    cycleIndex = 0;
    processedBlocks = new WeakSet();
    badge?.remove();
    badge = null;
    hideTip();
  }

  function boot() {
    if (!scanEnabled) return;
    startScan();
    scan(document.body);
    ensureObserver();
  }

  chrome.storage.sync.get({ autoScanPages: true }, (v) => {
    scanEnabled = !!v.autoScanPages;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if ("autoScanPages" in changes) {
      scanEnabled = !!changes.autoScanPages.newValue;
      if (scanEnabled) { startScan(); scan(document.body); ensureObserver(); }
      else stopScan();
    }
  });
})();
