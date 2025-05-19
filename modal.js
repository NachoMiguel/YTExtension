(() => {
  if (window.hasRunModalScript) return;
  window.hasRunModalScript = true;

  const API_KEY  = "AIzaSyAGOl0wVfpbnahbAdVNk1bM3_wkH668ch4";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const WINDOWS  = {
    all : Infinity,
    "24h":  1 * 24 * 60 * 60 * 1000,
    "7d" :  7 * 24 * 60 * 60 * 1000,
    "15d": 15 * 24 * 60 * 60 * 1000,
    "1m" : 30 * 24 * 60 * 60 * 1000,
    "3m" : 90 * 24 * 60 * 60 * 1000,
  };
  let modalCompetitors = [];

  /* ----------  MESSAGES ---------- */
  chrome.runtime.onMessage.addListener((msg,_s,sendResponse)=>{
    if(msg.action==="openCompetitorModal"){
      openDashboard().then(()=>sendResponse({status:"opened"})); return true;
    }
  });

  /* ----------  STORAGE LISTENER ---------- */
  chrome.storage.onChanged.addListener((chg,area)=>{
    if(area!=="local"||!chg.competitors) return;
    updateLocalCompetitors(chg.competitors.newValue||[]);
    const compSel=document.getElementById("competitorSel");
    const timeSel=document.getElementById("timeWindowSel");
    const grid   =document.getElementById("video-list");
    if(!grid||!compSel||!timeSel) return;
    if(compSel.value!=="all"&&!modalCompetitors.some(c=>c.channelId===compSel.value)){
      compSel.value="all"; grid.dataset.filter="all";
    }
    updateFilterDropdown(modalCompetitors,compSel);
    renderVideos(modalCompetitors,grid,compSel.value,timeSel.value);
  });

  /* ----------  DASHBOARD ---------- */
  async function openDashboard(){
    let modal=document.getElementById("competitor-dashboard-modal");
    if(modal){modal.style.display="flex";return;}

    modal=document.createElement("div");
    Object.assign(modal,{id:"competitor-dashboard-modal",
      style:`position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.6);z-index:9999;display:flex;justify-content:center;align-items:center;`});

    const card=document.createElement("div");
    Object.assign(card.style,{background:"#fff",padding:"20px",borderRadius:"12px",width:"92%",maxWidth:"1000px",maxHeight:"90vh",overflowY:"auto",position:"relative",boxShadow:"0 0 12px rgba(0,0,0,.3)",fontFamily:"Arial,sans-serif"});

    const close=document.createElement("button");
    close.textContent="×";
    Object.assign(close.style,{position:"absolute",top:"10px",right:"20px",fontSize:"24px",background:"none",border:"none",cursor:"pointer"});
    close.onclick=()=>{modal.style.display="none";};

    const header=document.createElement("div");
    Object.assign(header.style,{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"});

    const h2=document.createElement("h2");
    h2.textContent="Competitor Dashboard";

    const refresh=document.createElement("button");
    refresh.textContent="⟳ Refresh";
    Object.assign(refresh.style,{padding:"4px 10px",fontSize:"13px",cursor:"pointer",border:"1px solid #ccc",borderRadius:"4px",background:"#f3f3f3"});

    header.append(h2,refresh);

    const compSel=document.createElement("select");
    compSel.id="competitorSel";
    compSel.innerHTML=`<option value="all">All Competitors</option>`;
    Object.assign(compSel.style,{padding:"6px"});

    const timeSel=document.createElement("select");
    timeSel.id="timeWindowSel";
    timeSel.innerHTML=`
      <option value="all">All time</option>
      <option value="24h">Last 24 h</option>
      <option value="7d">7 days</option>
      <option value="15d">15 days</option>
      <option value="1m">1 month</option>
      <option value="3m">3 months</option>`;
    Object.assign(timeSel.style,{padding:"6px"});

    /* grid with tighter card width */
    const grid=document.createElement("div");
    grid.id="video-list"; grid.dataset.filter="all";
    Object.assign(grid.style,{
      display:"grid",
      gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",
      gap:"16px",
    });

    card.append(close,header,compSel,timeSel,grid);
    modal.appendChild(card); document.body.appendChild(modal);

    const {competitors:stored=[]}=await chrome.storage.local.get("competitors");
    updateLocalCompetitors(stored);
    updateFilterDropdown(modalCompetitors,compSel);
    await renderVideos(modalCompetitors,grid,"all","all");

    compSel.onchange=()=>{grid.dataset.filter=compSel.value;renderVideos(modalCompetitors,grid,compSel.value,timeSel.value);};
    timeSel.onchange=()=>{renderVideos(modalCompetitors,grid,compSel.value,timeSel.value);};
    refresh.onclick=async()=>{await invalidateCache(compSel.value);renderVideos(modalCompetitors,grid,compSel.value,timeSel.value,true);};
  }

  /* ----------  HELPERS ---------- */
  function updateLocalCompetitors(raw){ modalCompetitors=raw.map(e=>typeof e==="string"?{name:e,channelId:e}:e); }
  function updateFilterDropdown(list,sel){
    [...sel.querySelectorAll("option:not(:first-child)")].forEach(o=>o.remove());
    list.forEach(c=>{const o=document.createElement("option");o.value=c.channelId;o.textContent=c.name;sel.appendChild(o);});
  }

  /* ----------  RENDER ---------- */
  async function renderVideos(list,container,filterVal,winKey,force=false){
    container.innerHTML="Loading…";
    const targets=filterVal==="all"?list:list.filter(c=>c.channelId===filterVal);
    const windowMs=WINDOWS[winKey]??Infinity;
    const now=Date.now();
    container.innerHTML="";

    for(const c of targets){
      const vids=await getStatsCached(c.channelId,force);
      const filtered=vids.filter(v=>now-v.publishedAt<=windowMs)
                         .sort((a,b)=>b.views-a.views)
                         .slice(0,5);
      if(!filtered.length) continue;
      if(filterVal==="all"){
        const h=document.createElement("h3"); h.textContent=c.name; container.appendChild(h);
      }
      filtered.forEach(v=>container.appendChild(buildCard(v)));
    }
    if(!container.childElementCount) container.textContent="No videos in this time frame.";
  }

  function buildCard(v){
    const card=document.createElement("div");
    Object.assign(card.style,{border:"1px solid #ccc",borderRadius:"8px",overflow:"hidden",background:"#fafafa"});
    const img=document.createElement("img");
    img.src=v.thumbnail;
    img.style.width="100%";
    img.style.height="140px";           // fixed height
    img.style.objectFit="cover";        // crop nicely
    const info=document.createElement("div");info.style.padding="8px";
    const a=document.createElement("a");a.href=`https://www.youtube.com/watch?v=${v.videoId}`;a.target="_blank";a.textContent=v.title;
    Object.assign(a.style,{display:"block",fontSize:"13px",fontWeight:"bold",color:"#065fd4",textDecoration:"none",marginBottom:"4px"});
    const meta=document.createElement("div");
    meta.textContent=`${v.views.toLocaleString()} views • ${new Date(v.publishedAt).toLocaleDateString()}`;
    meta.style.fontSize="11px";meta.style.color="#555";
    info.append(a,meta);card.append(img,info);return card;
  }

  /* ----------  CACHE / API ---------- */
  async function getStatsCached(channelId,force){
    const key=`stats_${channelId}`; const now=Date.now();
    const {[key]:cache}=await chrome.storage.local.get(key);
    if(cache && !force && (now-cache.timestamp)<CACHE_TTL) return cache.data;
    const fresh=await fetchStats(channelId);
    await chrome.storage.local.set({[key]:{timestamp:now,data:fresh}});
    return fresh;
  }
  async function invalidateCache(filter){
    if(filter==="all"){
      const keys=modalCompetitors.map(c=>`stats_${c.channelId}`);
      await chrome.storage.local.remove(keys);
    }else await chrome.storage.local.remove(`stats_${filter}`);
  }

  async function resolveChannelId(idOrHandle){
    if(idOrHandle.startsWith("UC")) return idOrHandle;
    const handle=idOrHandle.replace(/^@/,"");
    try{
      const r=await fetch(`https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&part=id&type=channel&maxResults=1&q=${encodeURIComponent(handle)}`);
      const d=await r.json();
      return d.items?.[0]?.id?.channelId||idOrHandle;
    }catch{return idOrHandle;}
  }
  async function fetchStats(idOrHandle){
    try{
      const channelId=await resolveChannelId(idOrHandle);
      const cRes=await fetch(`https://www.googleapis.com/youtube/v3/channels?key=${API_KEY}&id=${channelId}&part=contentDetails`);
      const uploads=(await cRes.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if(!uploads) return[];
      const pRes=await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?key=${API_KEY}&playlistId=${uploads}&part=snippet&maxResults=50`);
      const ids=(await pRes.json()).items?.map(it=>it.snippet.resourceId.videoId).filter(Boolean)||[];
      if(!ids.length) return[];
      const vRes=await fetch(`https://www.googleapis.com/youtube/v3/videos?key=${API_KEY}&id=${ids.join(",")}&part=statistics,snippet`);
      return (await vRes.json()).items.map(it=>({
        videoId:it.id,
        title:it.snippet.title,
        thumbnail:it.snippet.thumbnails.medium.url,
        views:Number(it.statistics.viewCount||0),
        publishedAt:new Date(it.snippet.publishedAt).getTime(),
      }));
    }catch(e){console.error("fetchStats",e);return[];}
  }
})();
