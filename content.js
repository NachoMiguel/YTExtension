(() => {
  /* ----------  BUTTON LOGIC  ---------- */
  function insertCompetitorButton(channelId) {
    const container = document.querySelector("yt-flexible-actions-view-model");
    if (!container || document.getElementById("competitorBtn")) return;

    const btn = document.createElement("button");
    btn.id = "competitorBtn";
    Object.assign(btn.style, {
      marginLeft: "10px",
      padding: "6px 10px",
      border: "1px solid #ccc",
      borderRadius: "4px",
      cursor: "pointer",
    });

    if (chrome?.storage?.local) {
      chrome.storage.local.get("competitors", ({ competitors = [] }) => {
        btn.textContent = competitors.includes(channelId)
          ? "❌ Remove Competitor"
          : "⭐ Add as Competitor";
      });
    } else {
      console.warn("chrome.storage.local not available during button render");
    }

    btn.onclick = () => {
      if (!chrome?.storage?.local) {
        console.warn("chrome.storage.local not available during button click");
        return;
      }

      chrome.storage.local.get("competitors", ({ competitors = [] }) => {
        const list = [...competitors];
        const idx = list.indexOf(channelId);

        if (idx !== -1) {
          list.splice(idx, 1);
          btn.textContent = "⭐ Add as Competitor";
        } else {
          list.push(channelId);
          btn.textContent = "❌ Remove Competitor";

          // Auto-open dashboard modal
          chrome.runtime.sendMessage({ action: "openCompetitorModal" });
        }

        chrome.storage.local.set({ competitors: list });
      });
    };

    container.appendChild(btn);
  }

  /* ----------  DISCOVER CHANNEL HANDLE ---------- */
  function getHandle() {
    const m = location.href.match(/youtube\.com\/@([^\/?#&]+)/);
    return m ? m[1] : null;
  }

  /* ----------  TRY INSERT (runs repeatedly) ---------- */
  function tryInsert() {
    const handle = getHandle();
    if (!handle) return;
    const container = document.querySelector("yt-flexible-actions-view-model");
    if (container && !document.getElementById("competitorBtn")) {
      insertCompetitorButton(handle);
    }
  }

  /* ----------  INITIAL + CONTINUOUS OBSERVER ---------- */
  tryInsert();  // first pass

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
    }
    requestAnimationFrame(tryInsert);
  }).observe(document, { subtree: true, childList: true });
})();
