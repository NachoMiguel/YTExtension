(() => {
  if (window.hasRunModalScript) return;
  window.hasRunModalScript = true;

  const API_KEY = "AIzaSyAGOl0wVfpbnahbAdVNk1bM3_wkH668ch4";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const SHORTS_CUTOFF_SECONDS = 140;
  const WINDOWS = {
    all: Infinity,
    "24h": 1 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "15d": 15 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
    "3m": 90 * 24 * 60 * 60 * 1000,
  };
  let modalCompetitors = [];

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.action === "openCompetitorModal") {
      openDashboard().then(() => sendResponse({ status: "opened" }));
      return true;
    }
  });

  function updateLocalCompetitors(raw) {
    modalCompetitors = raw.map(e => typeof e === "string" ? { name: e, channelId: e } : e);
  }

  function updateFilterDropdown(list, sel) {
    [...sel.querySelectorAll("option:not(:first-child)")].forEach(o => o.remove());
    list.forEach(c => {
      const o = document.createElement("option");
      o.value = c.channelId;
      o.textContent = c.name;
      sel.appendChild(o);
    });
  }

  function parseDuration(iso) {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const h = parseInt(match?.[1] || "0");
    const m = parseInt(match?.[2] || "0");
    const s = parseInt(match?.[3] || "0");
    return h * 3600 + m * 60 + s;
  }

  async function resolveChannelId(idOrHandle) {
    if (idOrHandle.startsWith("UC")) return idOrHandle;
    const handle = idOrHandle.replace(/^@/, "");
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&part=id&type=channel&maxResults=1&q=${encodeURIComponent(handle)}`);
      const d = await r.json();
      return d.items?.[0]?.id?.channelId || idOrHandle;
    } catch {
      return idOrHandle;
    }
  }

  async function fetchStats(idOrHandle) {
    try {
      const channelId = await resolveChannelId(idOrHandle);

      const cRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?key=${API_KEY}&id=${channelId}&part=contentDetails`);
      const uploads = (await cRes.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new Error("Missing uploads playlist");

      const pRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?key=${API_KEY}&playlistId=${uploads}&part=snippet&maxResults=50`);
      const ids = (await pRes.json()).items?.map(it => it.snippet.resourceId.videoId).filter(Boolean) || [];
      if (!ids.length) throw new Error("No video IDs found");

      const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?key=${API_KEY}&id=${ids.join(",")}&part=statistics,snippet,contentDetails`);
      return (await vRes.json()).items.map(it => {
        const duration = parseDuration(it.contentDetails.duration);
        if (duration < SHORTS_CUTOFF_SECONDS) return null;
        return {
          videoId: it.id,
          title: it.snippet.title,
          thumbnail: it.snippet.thumbnails.medium.url,
          views: Number(it.statistics.viewCount || 0),
          publishedAt: new Date(it.snippet.publishedAt).getTime(),
          channelTitle: it.snippet.channelTitle
        };
      }).filter(Boolean);

    } catch (e) {
      console.error("fetchStats ERROR", { error: e, idOrHandle });
      return [];
    }
  }

  async function getStatsCached(channelId, force) {
    const key = `stats_${channelId}`;
    const now = Date.now();
    const { [key]: cache } = await chrome.storage.local.get(key);
    if (cache && !force && (now - cache.timestamp) < CACHE_TTL) return cache.data;
    const fresh = await fetchStats(channelId);
    await chrome.storage.local.set({ [key]: { timestamp: now, data: fresh } });
    return fresh;
  }

  async function invalidateCache(filter) {
    if (filter === "all") {
      const keys = modalCompetitors.map(c => `stats_${c.channelId}`);
      await chrome.storage.local.remove(keys);
    } else {
      await chrome.storage.local.remove(`stats_${filter}`);
    }
  }

  function buildCard(v) {
    const card = document.createElement("div");
    Object.assign(card.style, {
      display: "flex",
      gap: "12px",
      padding: "12px",
      borderBottom: "1px solid #eee",
      fontFamily: '"Segoe UI", Roboto, sans-serif',
      alignItems: "flex-start"
    });

    const img = document.createElement("img");
    img.src = v.thumbnail;
    img.style.width = "160px";
    img.style.height = "90px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "6px";

    const info = document.createElement("div");
    info.style.flex = "1";

    const a = document.createElement("a");
    a.href = `https://www.youtube.com/watch?v=${v.videoId}`;
    a.target = "_blank";
    a.textContent = v.title;
    Object.assign(a.style, {
      display: "block",
      fontSize: "15px",
      fontWeight: "600",
      color: "#111",
      textDecoration: "none",
      marginBottom: "4px",
      lineHeight: "1.3"
    });

    const metaTop = document.createElement("div");
    metaTop.textContent = `${v.channelTitle ?? "Unknown"} • ${formatAge(v.publishedAt)}`;
    Object.assign(metaTop.style, {
      fontSize: "13px",
      color: "#666",
      marginBottom: "2px"
    });

    const metaBottom = document.createElement("div");
    const views = v.views?.toLocaleString() ?? "–";
    const vph = v.vph?.toFixed(1) ?? "–";
    const flags = [];
    const ageHours = (Date.now() - v.publishedAt) / (1000 * 60 * 60);
    const ageDays = ageHours / 24;
    if (vph > 50 && ageHours < 72) flags.push("🔥 Trending");
    if (v.views > 100_000 && vph < 1 && ageDays > 30) flags.push("📦 Evergreen");

    metaBottom.textContent = `${views} views • ${vph} VPH` + (flags.length ? ` • ${flags.join(" • ")}` : "");
    Object.assign(metaBottom.style, {
      fontSize: "13px",
      color: "#444"
    });

    info.append(a, metaTop, metaBottom);
    card.append(img, info);
    return card;
  }

  function formatAge(publishedAt) {
    const hours = (Date.now() - publishedAt) / 1000 / 60 / 60;
    if (hours < 1) return "just now";
    if (hours < 24) return `${Math.floor(hours)} hours ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

    async function renderVideos(list, container, filterVal, winKey, sortBy, force = false) {
      console.log(`[renderVideos] Running with sortBy: ${sortBy}`);
      container.innerHTML = "Loading…";
      const windowMs = WINDOWS[winKey] ?? Infinity;
      const windowHours = windowMs / (1000 * 60 * 60);
      const now = Date.now();
      container.innerHTML = "";

      const calcVph = (views, publishedAt) => {
        const ageHours = (now - publishedAt) / (1000 * 60 * 60);

        if (winKey === "all") {
          const adjustedHours = Math.max(ageHours, 2); // ⏱️ Min 2 hours for smoother VPH
          return adjustedHours > 0 ? views / adjustedHours : 0;
        }

        return windowHours > 0 ? views / windowHours : 0;
      };

      const compileVideos = async (competitor) => {
        const vids = await getStatsCached(competitor.channelId, force);
        return vids
          .filter(v => now - v.publishedAt <= windowMs)
          .map(v => {
            const views = Number(v.views ?? 0);
            const vph = calcVph(views, v.publishedAt);
            return { ...v, views, vph };
          });
      };

      let videos = [];

      if (filterVal === "all") {
        const allResults = await Promise.all(list.map(compileVideos));
        videos = allResults.flat();
      } else {
        const c = list.find(c => c.channelId === filterVal);
        if (c) videos = await compileVideos(c);
      }

      console.log("Sorting videos by:", sortBy);
      console.table(videos.map(v => ({
        title: v.title,
        views: v.views,
        vph: v.vph?.toFixed(1)
      })));

      const sortedVideos = [...videos].sort((a, b) =>
        sortBy === "vph"
          ? (b.vph ?? 0) - (a.vph ?? 0)
          : (b.views ?? 0) - (a.views ?? 0)
      );

      const max = filterVal === "all" ? 20 : 10;
      const topVideos = sortedVideos.slice(0, max);

      console.log("Top sorted:", topVideos.map(v => v.title));

      topVideos.forEach(v => container.appendChild(buildCard(v)));

      if (!container.childElementCount) {
        container.textContent = "No videos in this time frame.";
      }
    }


  async function openDashboard() {
  let modal = document.getElementById("competitor-dashboard-modal");
  if (modal) {
    modal.style.display = "flex";
    return;
  }

  modal = document.createElement("div");
  Object.assign(modal, {
    id: "competitor-dashboard-modal",
    style: `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.6);z-index:9999;display:flex;justify-content:center;align-items:center;`
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#fff", padding: "20px", borderRadius: "12px", width: "92%",
    maxWidth: "1000px", maxHeight: "90vh", overflowY: "auto", position: "relative",
    boxShadow: "0 0 12px rgba(0,0,0,.3)", fontFamily: '"Segoe UI", Roboto, sans-serif'
  });

  const close = document.createElement("button");
  close.textContent = "×";
  Object.assign(close.style, {
    position: "sticky", top: "0", right: "0", marginLeft: "auto", fontSize: "24px",
    background: "none", border: "none", cursor: "pointer", zIndex: "10",
    display: "block", padding: "4px", alignSelf: "flex-end"
  });
  close.onclick = () => { modal.style.display = "none"; };

  const headerWrapper = document.createElement("div");
  Object.assign(headerWrapper.style, { display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" });

  const headerTop = document.createElement("div");
  Object.assign(headerTop.style, { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" });

  const h2 = document.createElement("h2");
  h2.textContent = "Competitor Dashboard";

  const refresh = document.createElement("button");
  refresh.textContent = "⟳ Refresh";
  Object.assign(refresh.style, {
    padding: "4px 10px", fontSize: "13px", cursor: "pointer",
    border: "1px solid #ccc", borderRadius: "4px", background: "#f3f3f3"
  });

  const headerBottom = document.createElement("div");
  Object.assign(headerBottom.style, { display: "flex", gap: "12px", flexWrap: "wrap" });

  const compSel = document.createElement("select");
  compSel.id = "competitorSel";
  compSel.innerHTML = `<option value="all">All Competitors</option>`;
  Object.assign(compSel.style, { padding: "6px" });

  const timeSel = document.createElement("select");
  timeSel.id = "timeWindowSel";
  timeSel.innerHTML = `
    <option value="all">All time</option>
    <option value="24h">Last 24 h</option>
    <option value="7d">7 days</option>
    <option value="15d">15 days</option>
    <option value="1m">1 month</option>
    <option value="3m">3 months</option>`;
  Object.assign(timeSel.style, { padding: "6px" });

  const sortSel = document.createElement("select");
  sortSel.id = "sortBySel";
  sortSel.innerHTML = `
    <option value="views">Sort by: Views</option>
    <option value="vph">Sort by: VPH</option>`;
  Object.assign(sortSel.style, { padding: "6px" });

  headerTop.append(h2, refresh);
  headerBottom.append(compSel, timeSel, sortSel);
  const infoNote = document.createElement("div");
  infoNote.textContent = "ℹ️ VPH is calculated using the selected window.";
  Object.assign(infoNote.style, {
    fontSize: "11px",
    color: "#666",
    marginTop: "4px"
  });

  headerWrapper.append(headerTop, headerBottom, infoNote);

  const grid = document.createElement("div");
  grid.id = "video-list"; grid.dataset.filter = "all";
  Object.assign(grid.style, {
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  });

  card.append(close, headerWrapper, grid);
  modal.appendChild(card); document.body.appendChild(modal);

  const { competitors: stored = [] } = await chrome.storage.local.get("competitors");
  updateLocalCompetitors(stored);
  updateFilterDropdown(modalCompetitors, compSel);

  // ✅ Bulletproof render with log
  const render = () => {
    const c = compSel.value;
    const t = timeSel.value;
    const s = sortSel.value;
    console.log("[renderVideos] filter:", c, "time:", t, "sort:", s);
    renderVideos(modalCompetitors, grid, c, t, s);
  };

  compSel.onchange = render;
  timeSel.onchange = render;
  sortSel.onchange = render;
  refresh.onclick = async () => {
    await invalidateCache(compSel.value);
    render();
  };

  render();
}

})();
