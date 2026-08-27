(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const PENDING_SELECTION_KEY = "pendingSelection";

  const COLORS = { slop: "#C42B1F", suspicious: "#8A6100", human: "#2E6B34" };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Merge overlapping spans so highlights never nest badly.
  function mergeSpans(findings) {
    const spans = findings.filter((f) => f.end > f.start).map((f) => [f.start, f.end]);
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of spans) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    return merged;
  }

  function renderMarked(text, findings) {
    const spans = mergeSpans(findings);
    let html = "";
    let cursor = 0;
    for (const [s, e] of spans) {
      html += escapeHtml(text.slice(cursor, s));
      html += `<mark>${escapeHtml(text.slice(s, e))}</mark>`;
      cursor = e;
    }
    html += escapeHtml(text.slice(cursor));
    return html;
  }

  function run() {
    const text = $("input").value;
    if (!text.trim()) return;
    const r = globalThis.SlopEngine.analyze(text);

    const stamp = $("stamp");
    stamp.textContent = r.label;
    stamp.style.color = COLORS[r.verdict];
    stamp.style.borderColor = COLORS[r.verdict];
    stamp.style.display = "inline-block";
    $("score").textContent = `${r.score}/100`;

    const marked = $("marked");
    const list = $("findings");
    const clean = $("clean");

    if (r.findings.length === 0) {
      marked.style.display = "none";
      list.style.display = "none";
      clean.style.display = "block";
      return;
    }
    clean.style.display = "none";

    marked.innerHTML = renderMarked(text, r.findings);
    marked.style.display = "block";

    list.innerHTML = r.findings
      .map((f) => `<li><span class="tag">${f.ruleId} · ${f.severity}</span>${escapeHtml(f.message)}</li>`)
      .join("");
    list.style.display = "block";
  }

  $("check").addEventListener("click", run);

  // Auto-scan toggle, persisted in sync storage.
  const autoScan = $("autoScan");
  chrome.storage.sync.get({ autoScanPages: true }, (v) => { autoScan.checked = !!v.autoScanPages; });
  autoScan.addEventListener("change", () => chrome.storage.sync.set({ autoScanPages: autoScan.checked }));

  async function loadPendingSelection() {
    const pending = await chrome.storage.session.get(PENDING_SELECTION_KEY);
    const text = pending[PENDING_SELECTION_KEY];
    if (typeof text !== "string" || !text.trim()) return;
    await chrome.storage.session.remove(PENDING_SELECTION_KEY);
    $("input").value = text;
    run();
  }

  void loadPendingSelection().catch(() => {
    /* The popup remains usable if session storage is unavailable. */
  });
})();
