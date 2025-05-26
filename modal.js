(() => {
if (window.hasRunModalScript) return;
window.hasRunModalScript = true;

const API_KEY = "AIzaSyAGOl0wVfpbnahbAdVNk1bM3_wkH668ch4";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const WINDOWS = {
  all: Infinity,
  "24h": 1 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "15d": 15 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "3m": 90 * 24 * 60 * 60 * 1000,
};

let modalCompetitors = [];

function formatAge(publishedAt) {
  const hours = (Date.now() - publishedAt) / 1000 / 60 / 60;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

async function buildSparklineSVG(videoId, large = false) {
  try {
    const { vphSnapshots = {} } = await chrome.storage.local.get("vphSnapshots");
    const list = vphSnapshots[videoId] || [];
    if (list.length < 2) {
      const msg = document.createElement("div");
      msg.textContent = "No data yet";
      msg.style.fontSize = "12px";
      msg.style.color = "#999";
      return msg;
    }

    const values = list.map(s => s.vph);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const width = large ? 220 : 100;
    const height = large ? 50 : 30;
    const step = width / (values.length - 1);

    const points = values.map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / (max - min)) * height;
      return `${x},${y.toFixed(1)}`;
    }).join(" ");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", points);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "#2196f3");
    polyline.setAttribute("stroke-width", "2");

    svg.appendChild(polyline);
    return svg;
  } catch (err) {
    console.warn("Sparkline build failed:", err.message);
    const fallback = document.createElement("div");
    fallback.textContent = "Chart unavailable";
    fallback.style.fontSize = "12px";
    fallback.style.color = "#999";
    return fallback;
  }
}

function updateLocalCompetitors(raw) {
  modalCompetitors = raw.map(e =>
    typeof e === "string" ? { name: e, channelId: e } : e
  );
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


async function saveToProduction(video) {
  const { productionVideos = [] } = await chrome.storage.local.get("productionVideos");
  const updated = [...productionVideos, video];
  await chrome.storage.local.set({ productionVideos: updated });
}

async function getProductionVideos() {
  const { productionVideos = [] } = await chrome.storage.local.get("productionVideos");
  return productionVideos;
}

async function invalidateCache(filter) {
  if (filter === "all") {
    const keys = modalCompetitors.map(c => `stats_${c.channelId}`);
    await chrome.storage.local.remove(keys);
  } else {
    await chrome.storage.local.remove(`stats_${filter}`);
  }
}

async function resolveChannelId(idOrHandle) {
  if (idOrHandle.startsWith("UC")) return idOrHandle;
  const handle = idOrHandle.replace(/^@/, "");
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&part=id&type=channel&maxResults=1&q=${encodeURIComponent(handle)}`
    );
    const d = await r.json();
    return d.items?.[0]?.id?.channelId || idOrHandle;
  } catch {
    return idOrHandle;
  }
}

async function fetchStats(idOrHandle) {
  try {
    const channelId = await resolveChannelId(idOrHandle);
    const cRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?key=${API_KEY}&id=${channelId}&part=contentDetails`
    );
    const uploads = (await cRes.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error("Missing uploads playlist");

    const pRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?key=${API_KEY}&playlistId=${uploads}&part=snippet&maxResults=50`
    );
    const ids = (await pRes.json()).items?.map(it => it.snippet.resourceId.videoId).filter(Boolean) || [];
    if (!ids.length) throw new Error("No video IDs found");

    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?key=${API_KEY}&id=${ids.join(",")}&part=statistics,snippet,contentDetails`
    );
    return (await vRes.json()).items.map(it => ({
      videoId: it.id,
      title: it.snippet.title,
      thumbnail: it.snippet.thumbnails.medium.url,
      views: Number(it.statistics.viewCount || 0),
      publishedAt: new Date(it.snippet.publishedAt).getTime(),
      channelTitle: it.snippet.channelTitle,
      duration: it.contentDetails.duration
    }));
  } catch (e) {
    console.error("fetchStats ERROR", e);
    return [];
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
    background: "#fff",
    padding: "20px",
    borderRadius: "12px",
    width: "92%",
    maxWidth: "1000px",
    minHeight: "600px",
    maxHeight: "90vh",
    overflowY: "auto",
    position: "relative",
    boxShadow: "0 0 12px rgba(0,0,0,.3)",
    fontFamily: '"Inter", "Segoe UI", Roboto, sans-serif'
  });

  const close = document.createElement("button");
  close.textContent = "×";
  Object.assign(close.style, {
    position: "sticky",
    top: "0",
    right: "0",
    marginLeft: "auto",
    fontSize: "24px",
    background: "none",
    border: "none",
    cursor: "pointer",
    zIndex: "10",
    display: "block",
    padding: "4px",
    alignSelf: "flex-end"
  });
  close.onclick = () => { modal.style.display = "none"; };

  const headerTop = document.createElement("div");
  Object.assign(headerTop.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "6px"
  });

  const h2 = document.createElement("h2");
  h2.textContent = "Competitor Dashboard";
  Object.assign(h2.style, {
    margin: 0,
    fontSize: "20px"
  });

  const toggle = document.createElement("button");
  toggle.textContent = "📂 Production Queue";
  Object.assign(toggle.style, {
    padding: "6px 10px",
    fontSize: "13px",
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: "6px",
    background: "#f3f3f3"
  });

  const refresh = document.createElement("button");
  refresh.textContent = "⟳ Refresh";
  Object.assign(refresh.style, {
    padding: "6px 10px",
    fontSize: "13px",
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: "6px",
    background: "#f3f3f3"
  });

  const injectTestData = document.createElement("button");
  injectTestData.textContent = "🐛 Inject Test Data";
  Object.assign(injectTestData.style, {
    padding: "6px 10px",
    fontSize: "13px",
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: "6px",
    background: "#f3f3f3"
  });
  injectTestData.onclick = async () => {
    const now = Date.now();
    const interval = 1000 * 60 * 60 * 6;
    const fakeVideoId = "mockedvideo123";
    const mocked = [
      { timestamp: now - interval * 5, vph: 40 },
      { timestamp: now - interval * 4, vph: 70 },
      { timestamp: now - interval * 3, vph: 90 },
      { timestamp: now - interval * 2, vph: 110 },
      { timestamp: now - interval * 1, vph: 85 },
      { timestamp: now, vph: 95 }
    ];
    const { vphSnapshots = {} } = await chrome.storage.local.get("vphSnapshots");
    vphSnapshots[fakeVideoId] = mocked;
    await chrome.storage.local.set({ vphSnapshots });
    alert("✅ Mocked data injected. Reload the dashboard to test sparkline.");
  };

  const buttonGroup = document.createElement("div");
  Object.assign(buttonGroup.style, {
    display: "flex",
    gap: "10px",
    alignItems: "center"
  });
  buttonGroup.append(toggle, refresh, injectTestData);
  headerTop.append(h2, buttonGroup);

  const compSel = document.createElement("select");
  compSel.id = "competitorSel";
  compSel.innerHTML = `<option value="all">All Competitors</option>`;
  Object.assign(compSel.style, {
    padding: "6px",
    fontSize: "13px"
  });

  const timeSel = document.createElement("select");
  timeSel.id = "timeWindowSel";
  timeSel.innerHTML = `
    <option value="all">All time</option>
    <option value="24h">Past 24 hours</option>
    <option value="7d">Past 7 days</option>
    <option value="15d">Past 15 days</option>
    <option value="1m">Past 1 month</option>
    <option value="3m">Past 3 months</option>`;
  Object.assign(timeSel.style, {
    padding: "6px",
    fontSize: "13px"
  });

  const sortSel = document.createElement("select");
  sortSel.id = "sortBySel";
  sortSel.innerHTML = `
    <option value="views">Sort by: Views</option>
    <option value="vph">Sort by: VPH</option>`;
  Object.assign(sortSel.style, {
    padding: "6px",
    fontSize: "13px"
  });

  const filterRow = document.createElement("div");
  Object.assign(filterRow.style, {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: "12px"
  });
  filterRow.append(compSel, timeSel, sortSel);

  const grid = document.createElement("div");
  grid.id = "video-list";
  Object.assign(grid.style, {
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  });

  card.append(close, headerTop, filterRow, grid);
  modal.appendChild(card);
  document.body.appendChild(modal);

  const { competitors: stored = [] } = await chrome.storage.local.get("competitors");
  updateLocalCompetitors(stored);
  updateFilterDropdown(modalCompetitors, compSel);

  let showingProd = false;
  const render = () => {
    if (showingProd) {
      renderProduction(grid);
      filterRow.style.display = "none";
    } else {
      const filter = compSel.value;
      const window = timeSel.value;
      const sort = sortSel.value;
      filterRow.style.display = "flex";
      renderVideos(modalCompetitors, grid, filter, window, sort);
    }
  };

  compSel.onchange = render;
  timeSel.onchange = render;
  sortSel.onchange = render;
  toggle.onclick = () => {
    showingProd = !showingProd;
    toggle.textContent = showingProd ? "⬅ Back to Top Videos" : "📂 Production Queue";
    render();
  };
  refresh.onclick = async () => {
    await invalidateCache(compSel.value);
    render();
  };

  render();
}

async function renderVideos(list, container, filterVal, winKey, sortBy = "views", force = false) {
  container.innerHTML = "Loading…";
  const windowMs = WINDOWS[winKey] ?? Infinity;
  const windowHours = windowMs / (1000 * 60 * 60);
  const now = Date.now();
  container.innerHTML = "";

  const production = await getProductionVideos();
  const prodIds = new Set(production.map(v => v.videoId));

  const calcVph = (views, publishedAt) => {
    const ageHours = (now - publishedAt) / (1000 * 60 * 60);
    const windowed = Math.min(ageHours, windowHours);
    return windowed > 0 ? views / windowed : 0;
  };

  const compileVideos = async (competitor) => {
    const vids = await fetchStats(competitor.channelId);
    return vids
      .filter(v => now - v.publishedAt <= windowMs)
      .filter(v => !prodIds.has(v.videoId))
      .map(v => {
        const views = Number(v.views ?? 0);
        const vph = calcVph(views, v.publishedAt);
        const ageHours = (now - v.publishedAt) / (1000 * 60 * 60);
        return { ...v, views, vph, ageHours };
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

  if (winKey === "24h" && videos.length) {
    const fastest = [...videos].sort((a, b) => b.vph - a.vph)[0]?.videoId;
    videos = videos.map(v => ({ ...v, isFastest: v.videoId === fastest }));
  }

  const { vphSnapshots = {} } = await chrome.storage.local.get("vphSnapshots");
  let updatedSnapshots = { ...vphSnapshots };

  for (const v of videos) {
    const snapList = updatedSnapshots[v.videoId] ?? [];
    const lastSnap = snapList[snapList.length - 1];
    const hoursSinceLast = lastSnap ? (now - lastSnap.timestamp) / (1000 * 60 * 60) : Infinity;

    if (hoursSinceLast >= 6) {
      snapList.push({ timestamp: now, vph: v.vph });
      if (snapList.length > 10) snapList.shift();
      updatedSnapshots[v.videoId] = snapList;
    }

    if (snapList.length >= 2) {
      const prev = snapList[snapList.length - 2].vph;
      const diff = (v.vph - prev) / prev;
      v.trend = diff >= 0.1 ? "up" : diff <= -0.1 ? "down" : null;
    } else {
      v.trend = null;
    }
  }

  await chrome.storage.local.set({ vphSnapshots: updatedSnapshots });

  const sortedVideos = [...videos].sort((a, b) =>
    sortBy === "vph" ? b.vph - a.vph : (b.views ?? 0) - (a.views ?? 0)
  );

  const max = filterVal === "all" ? 20 : 10;
  const topVideos = sortedVideos.slice(0, max);

  if (topVideos.length > 0) {
    topVideos[0].videoId = "mockedvideo123"; // For testing chart
  }

  topVideos.forEach(v => container.appendChild(buildCard(v, true)));

  if (!container.childElementCount) {
    container.textContent = "No videos in this time frame.";
  }
}

function buildCard(v, allowProd = true) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderBottom: "1px solid #eee",
    fontFamily: '"Segoe UI", Roboto, sans-serif',
    transition: "all 0.2s ease"
  });

  const topRow = document.createElement("div");
  Object.assign(topRow.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "flex-start"
  });

  const leftColumn = document.createElement("div");
  Object.assign(leftColumn.style, {
    display: "flex",
    flex: "1",
    gap: "12px"
  });

  const img = document.createElement("img");
  img.src = v.thumbnail;
  Object.assign(img.style, {
    width: "160px",
    height: "90px",
    objectFit: "cover",
    borderRadius: "6px",
    flexShrink: "0"
  });

  const info = document.createElement("div");
  info.style.flex = "1";

  const a = document.createElement("a");
  a.href = `https://www.youtube.com/watch?v=${v.videoId}`;
  a.target = "_blank";

  let prefix = "";
  if (v.trend === "up") prefix += "🔼 ";
  else if (v.trend === "down") prefix += "🔽 ";
  if (v.vph > 50 && v.ageHours < 72) prefix += "🔥 ";
  if (v.isFastest) prefix += "⭐ ";
  a.textContent = prefix + v.title;

  Object.assign(a.style, {
    display: "block",
    fontSize: "15px",
    fontWeight: "600",
    color: "#111",
    textDecoration: "none",
    marginBottom: "4px",
    lineHeight: "1.3",
    whiteSpace: "normal",
    wordBreak: "break-word"
  });

  const metaTop = document.createElement("div");
  metaTop.textContent = `${v.channelTitle ?? "Unknown"} • ${formatAge(v.publishedAt)}`;
  Object.assign(metaTop.style, {
    fontSize: "13px",
    color: "#666",
    marginBottom: "2px"
  });

  const metaBottom = document.createElement("div");
  metaBottom.textContent = `${v.views?.toLocaleString() ?? "–"} views • ${v.vph?.toFixed(1) ?? "–"} VPH`;
  Object.assign(metaBottom.style, {
    fontSize: "13px",
    color: "#444",
    marginBottom: "6px"
  });

  const buttonRow = document.createElement("div");
  Object.assign(buttonRow.style, {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap"
  });

  let mark;
  if (allowProd) {
    mark = document.createElement("button");
    mark.textContent = "🎬 Put in Production";
    Object.assign(mark.style, {
      padding: "4px 8px",
      fontSize: "12px",
      cursor: "pointer",
      background: "#eee",
      border: "1px solid #ccc",
      borderRadius: "4px"
    });
    mark.onclick = async () => {
      await saveToProduction(v);
      card.remove();
    };
    buttonRow.appendChild(mark);
  }

  const expandBtn = document.createElement("button");
  expandBtn.textContent = "📊 Show Growth";
  Object.assign(expandBtn.style, {
    padding: "4px 8px",
    fontSize: "12px",
    cursor: "pointer",
    background: "#eee",
    border: "1px solid #ccc",
    borderRadius: "4px"
  });

  const chartDiv = document.createElement("div");
  Object.assign(chartDiv.style, {
    display: "none",
    width: "280px",
    minHeight: "100px",
    justifyContent: "center",
    alignItems: "center"
  });

  expandBtn.onclick = async () => {
    const expanded = chartDiv.style.display === "none";
    chartDiv.style.display = expanded ? "flex" : "none";
    chartDiv.innerHTML = "";

    if (expanded) {
      const svg = await buildSparklineSVG(v.videoId, true);
      chartDiv.appendChild(svg);
    }

    card.style.border = expanded ? "2px solid #2196f3" : "none";
    card.style.boxShadow = expanded ? "0 0 8px rgba(0,0,0,0.1)" : "none";
    card.style.transform = expanded ? "scale(1.02)" : "scale(1)";
    img.style.width = expanded ? "200px" : "160px";
    img.style.height = expanded ? "112px" : "90px";
    a.style.fontSize = expanded ? "17px" : "15px";
    metaTop.style.fontSize = expanded ? "14px" : "13px";
    metaBottom.style.fontSize = expanded ? "14px" : "13px";
    mark && (mark.style.fontSize = expanded ? "13px" : "12px");
    expandBtn.style.fontSize = expanded ? "13px" : "12px";
  };

  buttonRow.appendChild(expandBtn);
  info.append(a, metaTop, metaBottom, buttonRow);
  leftColumn.append(img, info);
  topRow.append(leftColumn, chartDiv);
  card.append(topRow);
  return card;
}


chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.action === "openCompetitorModal") {
    openDashboard().then(() => sendResponse({ status: "opened" }));
    return true;
  }
});
})();
