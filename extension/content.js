(() => {
  "use strict";
  const HOST_ID = "slop-detector-overlay-host";

  function verdictColor(verdict) {
    return verdict === "slop" ? "#C42B1F" : verdict === "suspicious" ? "#8A6100" : "#2E6B34";
  }

  function showOverlay(text) {
    document.getElementById(HOST_ID)?.remove();
    const result = globalThis.SlopEngine.analyze(text);

    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });

    const top = result.findings.slice(0, 5);
    const items = top
      .map(
        (f) => `<li><span class="tag">${f.ruleId}</span>${escapeHtml(f.message)}</li>`
      )
      .join("");
    const more = result.findings.length > 5 ? `<p class="more">+ ${result.findings.length - 5} more findings</p>` : "";

    shadow.innerHTML = `
      <style>
        .card {
          all: initial;
          position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
          width: 340px; max-height: 60vh; overflow-y: auto;
          background: #F6F4EE; color: #23241F;
          border: 1.5px solid #23241F; border-radius: 3px;
          box-shadow: 4px 4px 0 rgba(35,36,31,.85);
          font: 13px/1.45 -apple-system, system-ui, sans-serif;
          padding: 16px;
        }
        .stamp {
          display: inline-block; transform: rotate(-4deg);
          border: 3px double ${verdictColor(result.verdict)}; color: ${verdictColor(result.verdict)};
          font: 700 15px/1 "American Typewriter", "Courier New", monospace;
          letter-spacing: .12em; padding: 6px 10px; border-radius: 3px;
          margin: 2px 0 10px;
        }
        .score { font: 700 12px/1 "Courier New", monospace; color: #55564F; margin-left: 8px; }
        ul { margin: 8px 0 0; padding: 0; list-style: none; }
        li { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid ${verdictColor(result.verdict)}; }
        .tag { display: block; font: 700 10px/1.6 "Courier New", monospace; letter-spacing: .08em; text-transform: uppercase; color: #55564F; }
        .more { color: #55564F; font-style: italic; margin: 4px 0 0; }
        .close {
          position: absolute; top: 8px; right: 10px; cursor: pointer;
          background: none; border: none; font: 700 14px/1 monospace; color: #23241F;
        }
        .clean { color: #2E6B34; margin: 0; }
      </style>
      <div class="card" role="dialog" aria-label="Slop Detector result">
        <button class="close" aria-label="Close">✕</button>
        <div><span class="stamp">${result.label}</span><span class="score">${result.score}/100 · ${result.wordCount}w</span></div>
        ${top.length ? `<ul>${items}</ul>${more}` : `<p class="clean">No slop patterns found in this selection.</p>`}
      </div>`;

    shadow.querySelector(".close").addEventListener("click", () => host.remove());
    document.documentElement.appendChild(host);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "slop:analyze" && typeof msg.text === "string" && msg.text.trim()) {
      showOverlay(msg.text);
    }
  });
})();
