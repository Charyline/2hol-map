/* 2HOL Town Map – upgraded with Discord login, ownership, icons & visibility
   Plain HTML/JS. Admins are whitelisted in Firebase at /admins/{discordId} = true
   Change DISCORD_CLIENT_ID before sharing.
*/

// ---------- Discord auth via the Node helper (server.js) ----------
// Login goes to AUTH_SERVER_URL/login. That server talks to Discord and
// redirects back here with #discord_user=...
// Set this to the PUBLIC URL of your Node process (no trailing slash).
const AUTH_SERVER_URL = "https://aaaa.prof.ninja";
const DISCORD_GUILD_ID  = "423293333864054833";  // official 2HOL guild
// Role name OR role id → level. Add your real 2HOL role names / IDs here.
const ROLE_LEVELS = {
  "admin": 5, "moderator": 4, "mod": 4, "elder": 3, "veteran": 2, "vet": 2, "member": 1
};
const VIS_LEVEL = { public: 0, members: 1, vets: 2, private: 99 };

const ICON_STYLES = {
  default:   { symbol: "circle",        color: "#3b82f6", label: "Default" },
  star:      { symbol: "star",          color: "#f59e0b", label: "Star" },
  tree:      { symbol: "triangle-up",   color: "#22c55e", label: "Tree / Nature" },
  tobacco:   { symbol: "diamond",       color: "#a16207", label: "Tobacco" },
  christmas: { symbol: "star",          color: "#ef4444", label: "Christmas" },
  event:     { symbol: "hexagon",       color: "#a855f7", label: "Event" },
  outpost:   { symbol: "square",        color: "#64748b", label: "Road / Outpost" },
  special:   { symbol: "diamond-wide",  color: "#ec4899", label: "Special" }
};

const firebaseConfig = {
  apiKey: "AIzaSyDsQ8twL_3Xu1d_Z81ejhq4tmGL7N8Hmv8",
  authDomain: "thisisanewproj.firebaseapp.com",
  databaseURL: "https://thisisanewproj.firebaseio.com",
  projectId: "thisisanewproj",
  storageBucket: "thisisanewproj.appspot.com",
  messagingSenderId: "257351124868",
  appId: "1:257351124868:web:04264194e22008b82ebfd1"
};

firebase.initializeApp(firebaseConfig);
const townRef = firebase.database().ref("/towns");
const metaRef = firebase.database().ref("/townMeta");

// ---------- State ----------
let rawData = {};
let townMeta = {};   // name -> { icon, visibility, desc, ownerId, ownerName, overrideX?, overrideY? }
let towns = {};
let isAdmin = false;
let chartReady = false;
let currentUser = null;   // { id, username, discriminator, avatar, roles: string[], level: number }

// ---------- Helpers ----------
function sanitize(str) {
  return DOMPurify.sanitize(String(str || ""), { ALLOWED_TAGS: [] });
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function parseCoord(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function userLevel() {
  if (isAdmin) return 5;
  return currentUser ? (currentUser.level || 1) : 0;
}

function canSee(town) {
  const need = VIS_LEVEL[town.visibility] || 0;
  if (need === 0) return true;
  if (need === 99) { // private
    return isAdmin || (currentUser && town.owners && town.owners.includes(currentUser.id));
  }
  return userLevel() >= need;
}

function canEdit(town) {
  if (isAdmin) return true;
  if (!currentUser) return false;
  // Owners can always edit; unowned towns can be claimed by anyone logged in
  if (!town.owners || town.owners.length === 0) return true;
  return town.owners.includes(currentUser.id);
}

// ---------- Compute towns (extended with meta) ----------
function metaKey(name) {
  // Firebase path-safe key for a town name
  return String(name || "").trim().replace(/[.#$[\]]/g, "_");
}

function computeTowns(tdata, meta) {
  meta = meta || {};
  const reports = [];
  const byName = {};

  Object.keys(tdata || {}).forEach(key => {
    const tmp = tdata[key];
    if (!tmp || !tmp.recv || !tmp.send) return;

    let townName, otherName;
    if (tmp.recv.type === "new") {
      townName = tmp.recv.name;
      otherName = tmp.send.name;
    } else if (tmp.send.type === "new") {
      townName = tmp.send.name;
      otherName = tmp.recv.name;
    } else {
      townName = tmp.recv.name;
      otherName = tmp.send.name;
    }
    if (!townName) return;

    reports.push({
      key,
      townName: String(townName).trim(),
      otherName: String(otherName || "").trim(),
      x: parseCoord(tmp.x),
      y: parseCoord(tmp.y),
      user: sanitize(tmp.user || "Anonymous"),
      desc: sanitize(tmp.desc || ""),
      ownerId: tmp.ownerId || null,
      ownerName: sanitize(tmp.ownerName || ""),
      icon: tmp.icon || "default",
      visibility: tmp.visibility || "public",
      type: tmp.type || tmp.icon || "default",
      raw: tmp
    });
  });

  const known = { "public town": { x: 0, y: 0 } };
  const pending = reports.filter(r => r.townName !== "public town");
  let progress = true, safety = 0;

  while (progress && safety < 50) {
    progress = false;
    safety++;
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i];
      if (!known[r.otherName]) continue;

      const src = known[r.otherName];
      let absX, absY;
      if (r.otherName === "public town") {
        absX = -r.x;
        absY = -r.y;
      } else {
        absX = src.x - r.x;
        absY = src.y - r.y;
      }

      if (!byName[r.townName]) byName[r.townName] = [];
      byName[r.townName].push({
        x: absX, y: absY,
        key: r.key, user: r.user, desc: r.desc,
        ownerId: r.ownerId, ownerName: r.ownerName,
        icon: r.icon, visibility: r.visibility, type: r.type,
        ref: r.otherName
      });

      if (!known[r.townName]) known[r.townName] = { x: absX, y: absY };
      pending.splice(i, 1);
      progress = true;
    }
  }

  byName["public town"] = [{
    x: 0, y: 0, key: null, user: "system", desc: "Spawn / origin",
    ownerId: null, icon: "star", visibility: "public", type: "default"
  }];

  const result = {};
  Object.keys(byName).forEach(name => {
    const list = byName[name];
    const xs = list.map(p => p.x);
    const ys = list.map(p => p.y);
    let mx = Math.round(median(xs));
    let my = Math.round(median(ys));
    let maxDev = Math.max(...xs.map(x => Math.abs(x - mx)), ...ys.map(y => Math.abs(y - my)), 0);

    // Prefer most recent non-default meta
    let icon = "default", visibility = "public", type = "default";
    const owners = new Set();
    let descs = [];
    list.forEach(p => {
      if (p.ownerId) owners.add(p.ownerId);
      if (p.desc) descs.push(p.desc);
      if (p.icon && p.icon !== "default") icon = p.icon;
      if (p.visibility && p.visibility !== "public") visibility = p.visibility;
      if (p.type && p.type !== "default") type = p.type;
    });
    // last report wins for meta if present
    const last = list[list.length - 1];
    if (last) {
      if (last.icon) icon = last.icon;
      if (last.visibility) visibility = last.visibility;
      if (last.type) type = last.type;
    }

    // Overlay /townMeta if present (true edits live here)
    const m = meta[name] || meta[metaKey(name)];
    if (m) {
      if (m.icon) { icon = m.icon; type = m.icon; }
      if (m.visibility) visibility = m.visibility;
      if (m.desc) descs = [m.desc, ...descs.filter(d => d !== m.desc)];
      if (m.ownerId) owners.add(m.ownerId);
      if (m.ownerName) { /* collected below */ }
      if (typeof m.overrideX === "number" && typeof m.overrideY === "number") {
        mx = Math.round(m.overrideX);
        my = Math.round(m.overrideY);
        maxDev = 0; // explicit override
      }
    }

    const ownerNames = new Set(list.map(p => p.ownerName).filter(Boolean));
    if (m && m.ownerName) ownerNames.add(m.ownerName);

    result[name] = {
      name, x: mx, y: my,
      reports: list.length,
      reporters: [...new Set(list.map(p => p.user))],
      keys: list.map(p => p.key).filter(Boolean),
      descs,
      owners: [...owners],
      ownerNames: [...ownerNames],
      icon, visibility, type,
      uncertain: maxDev > 2500,
      maxDev,
      hasMeta: !!m
    };
  });

  // Towns that exist only in meta (e.g. renamed) with absolute override
  Object.keys(meta).forEach(key => {
    const m = meta[key];
    const name = m.name || key;
    if (result[name]) return;
    if (typeof m.overrideX !== "number" || typeof m.overrideY !== "number") return;
    result[name] = {
      name,
      x: Math.round(m.overrideX),
      y: Math.round(m.overrideY),
      reports: 0,
      reporters: [],
      keys: [],
      descs: m.desc ? [m.desc] : [],
      owners: m.ownerId ? [m.ownerId] : [],
      ownerNames: m.ownerName ? [m.ownerName] : [],
      icon: m.icon || "default",
      visibility: m.visibility || "public",
      type: m.icon || "default",
      uncertain: false,
      maxDev: 0,
      hasMeta: true
    };
  });

  return result;
}

// ---------- Chart ----------
function drawChart(townMap) {
  const visible = Object.keys(townMap).filter(n => n !== "public town" && canSee(townMap[n]));
  const groups = {};
  visible.forEach(n => {
    const ic = townMap[n].icon || "default";
    if (!groups[ic]) groups[ic] = [];
    groups[ic].push(n);
  });

  const traces = [];

  // Origin
  traces.push({
    x: [0], y: [0],
    text: ["<b>public town</b><br>Origin (0, 0)"],
    mode: "markers", type: "scatter", name: "Origin",
    marker: { size: 16, color: "#22c55e", symbol: "star", line: { width: 1.5, color: "#fff" } },
    hoverinfo: "text",
    customdata: ["public town"]
  });

  Object.keys(groups).forEach(ic => {
    const style = ICON_STYLES[ic] || ICON_STYLES.default;
    const names = groups[ic];
    traces.push({
      x: names.map(n => townMap[n].x),
      y: names.map(n => townMap[n].y),
      text: names.map(n => {
        const t = townMap[n];
        return `<b>${sanitize(n)}</b><br>` +
          `x: ${t.x}  y: ${t.y}<br>` +
          `${style.label} · ${t.reports} report${t.reports !== 1 ? "s" : ""}` +
          (t.visibility !== "public" ? `<br>Visibility: ${t.visibility}` : "") +
          (t.uncertain ? "<br><i style='color:#f59e0b'>position uncertain</i>" : "");
      }),
      customdata: names,
      mode: "markers", type: "scatter", name: style.label,
      marker: {
        size: names.map(n => Math.min(18, 8 + Math.sqrt(townMap[n].reports) * 3)),
        color: names.map(n => townMap[n].uncertain ? "#f59e0b" : style.color),
        symbol: style.symbol,
        opacity: 0.9,
        line: { width: 1, color: "rgba(255,255,255,0.35)" }
      },
      hoverinfo: "text"
    });
  });

  const allX = [0, ...visible.map(n => townMap[n].x)];
  const allY = [0, ...visible.map(n => townMap[n].y)];
  const absVals = [...allX, ...allY].map(Math.abs).sort((a, b) => a - b);
  let maxAbs = absVals[Math.floor(absVals.length * 0.97)] || 15000;
  maxAbs = Math.ceil(maxAbs / 5000) * 5000;
  maxAbs = Math.max(maxAbs, 20000);
  const trueMax = Math.max(...absVals, 0);
  if (trueMax > maxAbs * 2) maxAbs = Math.ceil((trueMax * 0.7) / 5000) * 5000;

  const layout = {
    paper_bgcolor: "#0f1419", plot_bgcolor: "#0f1419",
    font: { color: "#e7ecf3", family: "Inter, sans-serif" },
    margin: { t: 30, r: 20, b: 40, l: 50 },
    xaxis: {
      title: "X", range: [-maxAbs, maxAbs],
      zeroline: true, zerolinecolor: "#6b7280", zerolinewidth: 2,
      gridcolor: "#1f2937", tickfont: { size: 11 },
      scaleanchor: "y", scaleratio: 1
    },
    yaxis: {
      title: "Y", range: [-maxAbs, maxAbs],
      zeroline: true, zerolinecolor: "#6b7280", zerolinewidth: 2,
      gridcolor: "#1f2937", tickfont: { size: 11 }
    },
    showlegend: true,
    legend: { bgcolor: "rgba(26,35,50,0.8)", bordercolor: "#2d3a4f", font: { size: 11 } },
    hovermode: "closest", dragmode: "pan"
  };

  const config = {
    responsive: true, displayModeBar: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    displaylogo: false, scrollZoom: true
  };

  Plotly.newPlot("chart", traces, layout, config).then(() => {
    chartReady = true;
    document.getElementById("chart").on("plotly_click", (data) => {
      if (!data.points || !data.points.length) return;
      const name = data.points[0].customdata;
      if (name) showDetail(name);
    });
  });
}

function showDetail(name) {
  const t = towns[name];
  if (!t) return;
  const card = document.getElementById("town-detail");
  document.getElementById("detail-name").textContent = name;
  const style = ICON_STYLES[t.icon] || ICON_STYLES.default;
  let html = `
    <div class="meta"><strong>Position:</strong> ${t.x}, ${t.y}</div>
    <div class="meta"><strong>Type:</strong> ${style.label}</div>
    <div class="meta"><strong>Visibility:</strong> ${t.visibility}</div>
    <div class="meta"><strong>Reports:</strong> ${t.reports}</div>
    <div class="meta"><strong>Reporters:</strong> ${t.reporters.join(", ") || "—"}</div>
  `;
  if (t.ownerNames && t.ownerNames.length) {
    html += `<div class="meta"><strong>Owners:</strong> ${t.ownerNames.join(", ")}</div>`;
  }
  if (t.descs && t.descs.length) {
    html += `<div class="meta"><strong>Notes:</strong> ${t.descs.slice(0, 3).join(" · ")}</div>`;
  }
  if (t.uncertain) {
    html += `<div class="meta" style="color:var(--warning)">⚠ Reports disagree (max Δ ≈ ${Math.round(t.maxDev)}).</div>`;
  }
  document.getElementById("detail-body").innerHTML = html;

  const actions = document.getElementById("detail-actions");
  if (canEdit(t)) {
    actions.classList.remove("hidden");
    document.getElementById("btn-edit-town").onclick = () => openEditModal(name);
  } else {
    actions.classList.add("hidden");
  }
  card.classList.remove("hidden");
}

// ---------- Views ----------
function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add("active");
  const btn = document.getElementById(`btn-${view}`);
  if (btn) btn.classList.add("active");

  if (view === "list") renderTownList();
  if (view === "my") renderMyTowns();
  if (view === "admin") {
    updateAdminPanel();
  }
  if (view === "map" && chartReady) {
    setTimeout(() => Plotly.Plots.resize("chart"), 50);
  }
}

function renderTownList() {
  const tbody = document.querySelector("#towns-table tbody");
  const search = (document.getElementById("search-towns").value || "").toLowerCase();
  const sort = document.getElementById("sort-towns").value;

  let list = Object.values(towns).filter(t => t.name !== "public town" && canSee(t));
  if (search) {
    list = list.filter(t =>
      t.name.toLowerCase().includes(search) ||
      t.reporters.some(r => r.toLowerCase().includes(search)) ||
      (t.ownerNames || []).some(o => o.toLowerCase().includes(search))
    );
  }
  list.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "reports") return b.reports - a.reports;
    if (sort === "x") return a.x - b.x;
    if (sort === "y") return a.y - b.y;
    if (sort === "type") return (a.icon || "").localeCompare(b.icon || "");
    return 0;
  });

  document.getElementById("list-count").textContent = `${list.length} towns`;
  tbody.innerHTML = list.map(t => {
    const style = ICON_STYLES[t.icon] || ICON_STYLES.default;
    return `<tr>
      <td><strong>${sanitize(t.name)}</strong>${t.uncertain ? " ⚠" : ""}</td>
      <td>${style.label}</td>
      <td class="num">${t.x}</td>
      <td class="num">${t.y}</td>
      <td class="num">${t.reports}</td>
      <td>${t.visibility}</td>
      <td>${sanitize((t.ownerNames || []).slice(0, 2).join(", ") || "—")}</td>
      <td>${sanitize((t.descs || [])[0] || "")}</td>
    </tr>`;
  }).join("");
}

function renderMyTowns() {
  const tbody = document.querySelector("#my-towns-table tbody");
  if (!currentUser) {
    tbody.innerHTML = "";
    document.getElementById("my-count").textContent = "0";
    return;
  }
  const list = Object.values(towns).filter(t =>
    t.name !== "public town" && t.owners && t.owners.includes(currentUser.id)
  );
  document.getElementById("my-count").textContent = `${list.length} towns`;
  tbody.innerHTML = list.map(t => {
    const style = ICON_STYLES[t.icon] || ICON_STYLES.default;
    return `<tr>
      <td><strong>${sanitize(t.name)}</strong></td>
      <td>${style.label}</td>
      <td class="num">${t.x}</td>
      <td class="num">${t.y}</td>
      <td>${t.visibility}</td>
      <td class="num">${t.reports}</td>
      <td><button class="secondary-btn" data-edit="${sanitize(t.name)}" style="padding:0.25rem 0.6rem;font-size:0.8rem">Edit</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.edit));
  });
}

function analyzeReports(data) {
  // Group by town name for duplicate / mirror detection
  const byTown = {};
  Object.keys(data || {}).forEach(k => {
    const r = data[k];
    if (!r || !r.recv) return;
    const name = (r.recv.name || "").trim();
    if (!byTown[name]) byTown[name] = [];
    byTown[name].push({
      key: k,
      x: parseCoord(r.x),
      y: parseCoord(r.y),
      send: (r.send && r.send.name) || "",
      user: r.user || ""
    });
  });

  const flags = {}; // key -> string[]
  const spamNames = /^(test|asdf|xxx|foo|bar|spam|delete\s*me|tmp|placeholder)$/i;
  const knownTowns = new Set(Object.keys(byTown));
  knownTowns.add("public town");

  Object.keys(byTown).forEach(name => {
    const list = byTown[name];
    // exact coord duplicates (keep first, flag rest)
    const seen = new Map();
    list.forEach(r => {
      const sig = `${r.x}|${r.y}|${r.send}`;
      if (!flags[r.key]) flags[r.key] = [];
      if (seen.has(sig)) {
        flags[r.key].push("dup");
      } else {
        seen.set(sig, r.key);
      }
    });
    // sign-flip mirrors: another report with approx (-x,-y) or (x,-y) or (-x,y)
    list.forEach(r => {
      if (flags[r.key].includes("dup")) return;
      const isMirror = list.some(o => {
        if (o.key === r.key) return false;
        const sameMag =
          (Math.abs(Math.abs(o.x) - Math.abs(r.x)) < 50 &&
           Math.abs(Math.abs(o.y) - Math.abs(r.y)) < 50);
        if (!sameMag) return false;
        // different sign pattern
        return (o.x !== r.x || o.y !== r.y) &&
               (Math.sign(o.x) !== Math.sign(r.x) || Math.sign(o.y) !== Math.sign(r.y) ||
                o.x === -r.x || o.y === -r.y);
      });
      if (isMirror) flags[r.key].push("mirror");
    });
    if (spamNames.test(name)) {
      list.forEach(r => flags[r.key].push("spam"));
    }
  });

  Object.keys(data || {}).forEach(k => {
    const r = data[k];
    if (!r) return;
    if (!flags[k]) flags[k] = [];
    const send = (r.send && r.send.name) || "";
    const recv = (r.recv && r.recv.name) || "";
    // orphan: relative to non-public town that has no reports of its own as recv
    if (send && send !== "public town" && !knownTowns.has(send)) {
      // also check if send appears as a resolved town name in computed towns
      if (!towns[send]) flags[k].push("orphan");
    }
    const x = Math.abs(parseCoord(r.x));
    const y = Math.abs(parseCoord(r.y));
    if (x > 80000 || y > 80000) flags[k].push("extreme");
  });

  return flags;
}

function renderReportsTable() {
  const tbody = document.querySelector("#reports-table tbody");
  if (!tbody) return;
  const search = (document.getElementById("search-reports").value || "").toLowerCase();
  const problemsOnly = document.getElementById("filter-problems")?.checked;

  const flags = analyzeReports(rawData);
  let keys = Object.keys(rawData || {});

  if (search) {
    keys = keys.filter(k => JSON.stringify(rawData[k]).toLowerCase().includes(search));
  }
  if (problemsOnly) {
    keys = keys.filter(k => (flags[k] || []).length > 0);
  }

  // Sort: flagged first, then by town name
  keys.sort((a, b) => {
    const fa = (flags[a] || []).length;
    const fb = (flags[b] || []).length;
    if (fa !== fb) return fb - fa;
    const na = (rawData[a]?.recv?.name || "").toLowerCase();
    const nb = (rawData[b]?.recv?.name || "").toLowerCase();
    return na.localeCompare(nb);
  });

  const flaggedCount = keys.filter(k => (flags[k] || []).length > 0).length;
  document.getElementById("report-count").textContent =
    `${keys.length} shown` + (flaggedCount ? ` · ${flaggedCount} flagged` : "");

  tbody.innerHTML = keys.map(k => {
    const r = rawData[k];
    const f = flags[k] || [];
    const flagClass = f.length ? "flag-" + f[0] : "";
    const badges = f.map(x => `<span class="flag-badge ${x}">${x}</span>`).join(" ");
    return `<tr class="${flagClass}">
      <td>${badges || "—"}</td>
      <td>${sanitize(r.recv?.name || "?")}</td>
      <td>${sanitize(r.send?.name || "?")}</td>
      <td class="num">${r.x}</td>
      <td class="num">${r.y}</td>
      <td>${sanitize(r.user || "")}</td>
      <td style="font-size:0.65rem;max-width:90px;overflow:hidden;text-overflow:ellipsis" title="${k}">${k}</td>
      <td><button class="del-btn" data-key="${k}">Delete</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const key = e.target.dataset.key;
      const r = rawData[key];
      const label = r?.recv?.name || key;
      if (!confirm(`Delete report for "${label}"?\n${key}`)) return;
      try { await townRef.child(key).remove(); }
      catch (err) { alert("Delete failed: " + err.message); }
    });
  });
}

function refreshSelect() {
  const sel = document.getElementById("stown");
  const current = sel.value || "public town";
  const names = Object.keys(towns).filter(n => canSee(towns[n]) || n === "public town")
    .sort((a, b) => {
      if (a === "public town") return -1;
      if (b === "public town") return 1;
      return a.localeCompare(b);
    });
  sel.innerHTML = `<option value="" disabled>Select a known town…</option>` +
    names.map(n => `<option value="${sanitize(n)}" ${n === current ? "selected" : ""}>${sanitize(n)}</option>`).join("");
}

function checkNameSimilarity() {
  const input = document.getElementById("rtown").value.trim().toLowerCase();
  const warn = document.getElementById("name-warning");
  if (!input || input.length < 3) { warn.classList.add("hidden"); return; }
  const matches = Object.keys(towns).filter(n => {
    const ln = n.toLowerCase();
    return ln !== input && (ln.includes(input) || input.includes(ln) || levenshtein(ln, input) <= 2);
  }).slice(0, 4);
  if (matches.length) {
    warn.innerHTML = `Similar existing: <strong>${matches.map(sanitize).join(", ")}</strong>. Exact name match will be averaged.`;
    warn.classList.remove("hidden");
  } else warn.classList.add("hidden");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ---------- Edit modal ----------
function openEditModal(name) {
  const t = towns[name];
  if (!t || !canEdit(t)) return;
  document.getElementById("edit-original-name").value = name;
  document.getElementById("edit-name").value = name;
  document.getElementById("edit-x").value = "";
  document.getElementById("edit-y").value = "";
  document.getElementById("edit-icon").value = t.icon || "default";
  document.getElementById("edit-visibility").value = t.visibility || "public";
  document.getElementById("edit-desc").value = (t.descs && t.descs[0]) || "";
  document.getElementById("edit-modal").classList.remove("hidden");
}

document.getElementById("edit-cancel").addEventListener("click", () => {
  document.getElementById("edit-modal").classList.add("hidden");
});

document.getElementById("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const original = document.getElementById("edit-original-name").value;
  const newName = document.getElementById("edit-name").value.trim();
  const x = document.getElementById("edit-x").value;
  const y = document.getElementById("edit-y").value;
  const icon = document.getElementById("edit-icon").value;
  const visibility = document.getElementById("edit-visibility").value;
  const desc = document.getElementById("edit-desc").value.trim();

  if (!newName) return alert("Name required");

  const t = towns[original];
  const meta = {
    name: newName,
    icon: icon || "default",
    visibility: visibility || "public",
    updatedAt: Date.now()
  };
  if (desc) meta.desc = desc;
  if (currentUser) {
    meta.ownerId = currentUser.id;
    meta.ownerName = currentUser.username;
  }

  // Optional absolute position override (map coords, not HETUW)
  if (x !== "" && y !== "") {
    meta.overrideX = parseInt(x, 10);
    meta.overrideY = parseInt(y, 10);
  } else if (t) {
    // keep current displayed position as override so rename still has coords
    meta.overrideX = t.x;
    meta.overrideY = t.y;
  }

  try {
    // Write metadata under the (possibly new) name — this is the real "edit"
    await metaRef.child(metaKey(newName)).set(meta);

    // If renamed, remove old meta key so the old label stops getting overlay
    if (newName !== original) {
      await metaRef.child(metaKey(original)).remove();
    }

    // Do NOT push a new report unless user explicitly set new coords
    // (reports stay as the democratic position source; meta holds owner edits)
    document.getElementById("edit-modal").classList.add("hidden");
    alert("Town updated. Map will refresh shortly.");
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

// ---------- Discord Auth ----------
function levelFromRoles(roles) {
  let level = 1; // logged-in + in guild
  (roles || []).forEach((r) => {
    const n = ROLE_LEVELS[String(r).toLowerCase()] || ROLE_LEVELS[String(r)] || 0;
    if (n > level) level = n;
  });
  return level;
}

function loginWithDiscord() {
  if (!AUTH_SERVER_URL) {
    alert("Set AUTH_SERVER_URL in script.js to your public Node auth server (the host running server.js), e.g. https://auth.prof.ninja");
    return;
  }
  window.location.href = AUTH_SERVER_URL.replace(/\/$/, "") + "/login";
}

async function handleDiscordCallback() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const err = params.get("discord_error");
  const packed = params.get("discord_user");

  // Always strip the hash so a refresh does not re-process it
  if (err || packed) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  if (err) {
    if (err === "not_in_guild") {
      alert("You need to be in the official 2HOL Discord to log in.");
    } else {
      alert("Discord login failed: " + err);
    }
    return;
  }
  if (!packed) return;

  try {
    const json = atob(packed.replace(/-/g, "+").replace(/_/g, "/"));
    const me = JSON.parse(json);
    let roles = me.roles || me.roleIds || [];
    let level = levelFromRoles(roles);

    try {
      const snap = await firebase.database().ref(`/discordRoles/${me.id}`).once("value");
      const stored = snap.val();
      if (stored && Array.isArray(stored.roles)) {
        roles = stored.roles;
        level = Math.max(level, levelFromRoles(roles));
      } else if (stored && typeof stored.level === "number") {
        level = Math.max(level, stored.level);
      }
    } catch (_) {}

    currentUser = {
      id: me.id,
      username: me.nick || me.username,
      discriminator: me.discriminator,
      avatar: me.avatar,
      roles,
      roleIds: me.roleIds || [],
      level
    };
    localStorage.setItem("2hol_discord", JSON.stringify(currentUser));
    updateAuthUI();
    await checkAdminStatus();
    processAndRender();
  } catch (e) {
    console.error("Discord callback parse failed", e);
    alert("Discord login failed (could not read user payload).");
  }
}

function logout() {
  currentUser = null;
  isAdmin = false;
  localStorage.removeItem("2hol_discord");
  updateAuthUI();
  updateAdminPanel();
  processAndRender();
}

function updateAuthUI() {
  const loginBtn = document.getElementById("btn-login");
  const menu = document.getElementById("user-menu");
  const myBtn = document.getElementById("btn-my");
  if (currentUser) {
    loginBtn.classList.add("hidden");
    menu.classList.remove("hidden");
    document.getElementById("user-name").textContent = currentUser.username;
    document.getElementById("user-avatar").src = currentUser.avatar;
    myBtn.classList.remove("hidden");
  } else {
    loginBtn.classList.remove("hidden");
    menu.classList.add("hidden");
    myBtn.classList.add("hidden");
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("2hol_discord") || "null");
    if (saved && saved.id) {
      currentUser = saved;
      updateAuthUI();
    }
  } catch (_) {}
}

// ---------- Main data ----------
function processAndRender() {
  towns = computeTowns(rawData, townMeta);
  drawChart(towns);
  refreshSelect();
  if (document.getElementById("view-list").classList.contains("active")) renderTownList();
  if (document.getElementById("view-my").classList.contains("active")) renderMyTowns();
  if (isAdmin && document.getElementById("view-admin").classList.contains("active")) renderReportsTable();
}

townRef.on("value", ss => {
  rawData = ss.val() || {};
  processAndRender();
});
metaRef.on("value", ss => {
  // Index meta by both path key and display name
  const raw = ss.val() || {};
  townMeta = {};
  Object.keys(raw).forEach(k => {
    const m = raw[k];
    if (!m) return;
    townMeta[k] = m;
    if (m.name) townMeta[m.name] = m;
  });
  processAndRender();
});

// ---------- Form submit ----------
document.getElementById("bellreport").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const rtown = document.getElementById("rtown").value.trim();
  const stown = document.getElementById("stown").value;
  const xcoord = document.getElementById("xcoord").value;
  const ycoord = document.getElementById("ycoord").value;
  const username = document.getElementById("user").value.trim() || (currentUser ? currentUser.username : "Anonymous");
  const desc = document.getElementById("desc").value.trim();
  const icon = document.getElementById("icon").value || "default";
  const visibility = document.getElementById("visibility").value || "public";

  if (!rtown) return alert("Please provide a name for your town.");
  if (!stown) return alert("Please select which town rang the bell.");
  if (xcoord === "" || ycoord === "") return alert("Please enter both coordinates.");

  const payload = {
    recv: { name: rtown, type: "new" },
    send: { name: stown, type: "existing" },
    user: username,
    x: xcoord, y: ycoord,
    icon, visibility, type: icon
  };
  if (desc) payload.desc = desc;
  if (currentUser) {
    payload.ownerId = currentUser.id;
    payload.ownerName = currentUser.username;
  }

  try {
    await townRef.push(payload);
    alert("Town reported! Map will update shortly.");
    document.getElementById("rtown").value = "";
    document.getElementById("xcoord").value = "";
    document.getElementById("ycoord").value = "";
    document.getElementById("desc").value = "";
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
});

// ---------- Wiring ----------
document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
document.querySelector(".panel-header").addEventListener("click", () => {
  document.getElementById("form-panel").classList.toggle("collapsed");
});
document.querySelector(".close-detail").addEventListener("click", () => {
  document.getElementById("town-detail").classList.add("hidden");
});
document.getElementById("search-towns").addEventListener("input", renderTownList);
document.getElementById("sort-towns").addEventListener("change", renderTownList);
document.getElementById("search-reports").addEventListener("input", renderReportsTable);
document.getElementById("filter-problems")?.addEventListener("change", renderReportsTable);
document.getElementById("rtown").addEventListener("input", checkNameSimilarity);
document.getElementById("btn-login").addEventListener("click", loginWithDiscord);
document.getElementById("btn-logout").addEventListener("click", logout);

document.getElementById("recompute-btn").addEventListener("click", () => {
  processAndRender();
  alert("Map recomputed.");
});

// ---------- Admin whitelist (Firebase /admins/{discordId} = true) ----------
async function checkAdminStatus() {
  isAdmin = false;
  if (!currentUser || !currentUser.id) {
    updateAdminPanel();
    return;
  }
  try {
    const snap = await firebase.database().ref(`/admins/${currentUser.id}`).once("value");
    isAdmin = !!snap.val();
  } catch (err) {
    console.warn("Could not check admin status", err);
    isAdmin = false;
  }
  updateAdminPanel();
  // re-render so visibility & edit buttons update
  processAndRender();
}

function updateAdminPanel() {
  const denied = document.getElementById("admin-denied");
  const panel = document.getElementById("admin-panel");
  const hint = document.getElementById("admin-denied-hint");
  if (!denied || !panel) return;

  if (isAdmin) {
    denied.classList.add("hidden");
    panel.classList.remove("hidden");
    renderReportsTable();
  } else {
    denied.classList.remove("hidden");
    panel.classList.add("hidden");
    if (hint) {
      if (!currentUser) {
        hint.textContent = "Log in with Discord first. Then ask an existing admin to add your Discord ID under /admins/{id} = true in Firebase.";
      } else {
        hint.textContent = `Logged in as ${currentUser.username} (${currentUser.id}). This ID is not in /admins. Ask an existing admin to whitelist you.`;
      }
    }
  }
}

// Boot
restoreSession();
handleDiscordCallback().then(() => checkAdminStatus());
switchView("map");
updateAuthUI();
checkAdminStatus();
