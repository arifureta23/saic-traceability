// SAIC Farmer Registry — main application
import { createApi } from "./api.js";
import { STRINGS, FIELDS } from "./i18n.js";
import { LOGO } from "./logo.js";
import * as C from "./checks.js";
import { POLYGON_THRESHOLD_HA, MIN_DECIMALS, isNum, plotLabel, norm, polyAreaHa, bbox, hasPoly, plotPoint, plotStatus } from "./checks.js";
document.getElementById("brandLogo").src = LOGO;

/* ---------- rules (tweak here) ---------- */
const REGIONS = ["Adamawa", "Centre", "East", "Far North", "Littoral", "North", "Northwest", "South", "Southwest", "West"];
const TYPES = ["Farmer", "Collector", "Cooperative", "Company", "Other"];
const DECISIONS = ["", "Approved", "Hold", "Rejected"];
const ID_TYPES = ["", "CNI", "Passport", "Récépissé", "Birth certificate", "Other"];

/* ---------- state ---------- */
const S = { api: null, me: null, farmers: [], loaded: false, offline: false, cacheAt: null, q: "", fStatus: "", fRegion: "", showArchived: false, photos: {}, people: {}, loadError: "" };
let L = (() => { try { return localStorage.getItem("saic-lang") || (navigator.language || "en").slice(0, 2); } catch (e) { return "en"; } })();
if (!STRINGS[L]) L = "en";

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const t = (k, p = {}) => String(STRINGS[L][k] ?? STRINGS.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x] ?? "");
const fl = k => FIELDS[L][k] || FIELDS.en[k] || k;
const locale = () => (L === "fr" ? "fr-FR" : "en-GB");
const fmt = (n, d = 0) => Number(n).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => new Date().toISOString().slice(0, 10);
const dateFmt = iso => { if (!iso) return ""; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? iso : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }); };
const dtFmt = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
const clone = o => JSON.parse(JSON.stringify(o));
const canWrite = () => !S.offline && S.me && ["lead", "warehouse"].includes(S.me.role);
const isLead = () => S.me && S.me.role === "lead";
function toast(msg) { const h = $("#toastHost"); h.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => h.innerHTML = "", 3600); }

/* ---------- F01 checks (js/checks.js) ---------- */
const parseGeometry = text => C.parseGeometry(text, L);
const allGeoms = () => C.allGeoms(S.farmers);
const plotIssues = (f, p, geoms) => C.plotIssues(f, p, geoms, fmt);
const evaluate = (f, geoms = allGeoms()) => C.evaluate(f, geoms, S.farmers, fmt);
const pill = s => `<span class="pill ${s}">${esc(t("status." + s))}</span>`;
const issueText = i => t(i.k, i.p);

/* ---------- data ---------- */
async function loadAll() {
  try {
    S.farmers = await S.api.listFarmers();
    S.offline = false; S.loadError = "";
    if (S.api.mode === "live") { try { localStorage.setItem("saic-cache", JSON.stringify({ at: new Date().toISOString(), farmers: S.farmers })); } catch (e) {} }
  } catch (e) {
    let cache = null; try { cache = JSON.parse(localStorage.getItem("saic-cache")); } catch (x) {}
    if (cache && (!navigator.onLine || /fetch|network/i.test(e.message))) { S.farmers = cache.farmers; S.cacheAt = cache.at; S.offline = true; }
    else S.loadError = e.message;
  }
  S.loaded = true;
  render();
  loadPhotos(S.farmers.map(f => f.photoPath));
}
async function loadPhotos(paths) {
  paths = paths.filter(p => p && !S.photos[p]);
  if (!paths.length || S.offline) return;
  try { Object.assign(S.photos, await S.api.photoUrls(paths)); render(); } catch (e) {}
}
function replaceFarmer(f) { const i = S.farmers.findIndex(x => x.id === f.id); if (i >= 0) S.farmers[i] = f; else S.farmers.push(f); S.farmers.sort((a, b) => a.id.localeCompare(b.id)); }
async function loadPeople() {
  if (S.api.mode !== "live") { S.people = { demo: "Demo user" }; return; }
  try { const ps = await S.api.profiles(); S.people = Object.fromEntries(ps.map(p => [p.id, p.full_name])); S.profiles = ps; } catch (e) {}
}

/* ---------- routing / shell ---------- */
const route = () => location.hash.replace(/^#/, "") || "overview";
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
window.addEventListener("online", () => { if (S.offline) loadAll(); });
function shell() {
  document.documentElement.lang = L;
  $("#nav").innerHTML = ["overview", "farmers", "map", "team"].map(r => `<a href="#${r}" data-r="${r}">${esc(t("nav." + r))}${r === "farmers" ? ` <small>${S.farmers.filter(f => !f.archived).length || ""}</small>` : ""}</a>`).join("");
  $("#railFoot").innerHTML = `<a href="reception/">${esc(t("nav.reception"))}</a><a href="tresorerie/">${esc(t("nav.treasury"))}</a><a href="confidentialite/producteurs/">${L === "en" ? "Farmer information sheet" : "Fiche d'information producteur"}</a><span>${esc(t("foot.forms"))}</span>${S.me ? `<span>${esc(S.me.name)}<br>${esc(t("role." + S.me.role))}</span>` : ""}
    <div class="row"><button class="btn small" id="langBtn">${esc(t("lang.switch"))}</button>${S.api && S.api.mode === "live" && S.me ? `<button class="btn small" id="outBtn">${esc(t("auth.signout"))}</button>` : ""}</div>
    ${S.api && S.api.mode === "demo" ? `<a href="#" id="resetDemo">${esc(t("demo.reset"))}</a>` : ""}`;
  $("#langBtn").onclick = () => { L = L === "fr" ? "en" : "fr"; try { localStorage.setItem("saic-lang", L); } catch (e) {} render(); };
  const ob = $("#outBtn"); if (ob) ob.onclick = async () => { await S.api.signOut(); try { localStorage.removeItem("saic-me"); localStorage.removeItem("saic-cache"); } catch (e) {} S.me = null; S.farmers = []; render(); };
  const rd = $("#resetDemo"); if (rd) rd.onclick = e => { e.preventDefault(); S.api.reset(); location.hash = "overview"; loadAll(); };
  const r = route();
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === r || (r.startsWith("farmer-") && a.dataset.r === "farmers")));
}
function render() {
  shell();
  const m = $("#main");
  if (!S.api) { m.innerHTML = `<div class="card">${esc(t("loading"))}</div>`; return; }
  if (!S.me) { m.innerHTML = viewLogin(); bindLogin(); return; }
  if (!S.loaded) { m.innerHTML = `<div class="card">${esc(t("loading"))}</div>`; return; }
  if (S.loadError) { m.innerHTML = `<div class="notice">${esc(t("load.error", { msg: S.loadError }))}</div>`; return; }
  const banner = (S.api.mode === "demo" ? `<div class="notice info">${esc(t("demo.banner"))}</div>` : "")
    + (S.offline ? `<div class="notice">${esc(t("offline.banner", { date: dtFmt(S.cacheAt) }))}</div>` : "")
    + (S.me.role === "viewer" ? `<div class="notice info">${esc(t("viewer.banner"))}</div>` : "");
  const r = route();
  if (r.startsWith("farmer-")) { const f = S.farmers.find(x => x.id === r.slice(7)); m.innerHTML = banner + (f ? viewProfile(f) : `<div class="card"><a href="#farmers">${esc(t("pro.back"))}</a></div>`); if (f) afterProfile(f); return; }
  if (r === "farmers") { m.innerHTML = banner + viewList(); bindList(); return; }
  if (r === "map") { m.innerHTML = banner + viewMap(); return; }
  if (r === "team") { m.innerHTML = banner + viewTeam(); bindTeam(); return; }
  m.innerHTML = banner + viewOverview(); afterOverview();
}

/* ---------- login ---------- */
let recovery = false;
function viewLogin() {
  if (recovery) return `<div class="card login stack"><h1>${esc(t("auth.newpw"))}</h1>
    <form id="pwForm" class="stack" novalidate><div class="f"><label for="newPw">${esc(t("auth.password"))}</label><input id="newPw" type="password" autocomplete="new-password" minlength="8" required></div>
    <span class="err" id="loginErr"></span><button class="btn primary" type="submit">${esc(t("auth.save_pw"))}</button></form></div>`;
  return `<div class="card login stack"><img class="login-logo" src="${LOGO}" alt="SAIC"><div><h1>${esc(t("auth.title"))}</h1><p class="muted">${esc(t("auth.sub"))}</p></div>
    <form id="loginForm" class="stack" novalidate>
      <div class="f"><label for="em">${esc(t("auth.email"))}</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="f"><label for="pw">${esc(t("auth.password"))}</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <span class="err" id="loginErr"></span>
      <button class="btn primary" type="submit" id="loginBtn">${esc(t("auth.signin"))}</button>
      <a href="#" id="forgot">${esc(t("auth.forgot"))}</a>
    </form><p class="privacy-link" style="font-size:13px;text-align:center;color:var(--muted);margin:0"><a href="/confidentialite/" style="color:inherit">${document.documentElement.lang === "en" ? "Privacy policy" : "Politique de confidentialité"}</a> · <a href="/conditions/" style="color:inherit">${document.documentElement.lang === "en" ? "Terms of use" : "Conditions d'utilisation"}</a></p></div>`;
}
function bindLogin() {
  const pf = $("#pwForm");
  if (pf) { pf.onsubmit = async e => { e.preventDefault(); try { await S.api.setPassword($("#newPw").value); recovery = false; toast(t("auth.pw_saved")); await start(); } catch (x) { $("#loginErr").textContent = x.message; } }; return; }
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); $("#loginBtn").disabled = true; $("#loginErr").textContent = "";
    try { await S.api.signIn($("#em").value.trim(), $("#pw").value); await start(); }
    catch (x) { $("#loginErr").textContent = /invalid/i.test(x.message) ? t("auth.bad") : x.message; $("#loginBtn").disabled = false; }
  };
  $("#forgot").onclick = async e => { e.preventDefault(); const em = $("#em").value.trim(); if (!em) { $("#loginErr").textContent = t("auth.enter_email"); return; } try { await S.api.resetPassword(em); } catch (x) {} $("#loginErr").textContent = t("auth.reset_sent"); };
}

/* ---------- overview ---------- */
function viewOverview() {
  const live = S.farmers.filter(f => !f.archived), geoms = allGeoms();
  const ev = live.map(f => ({ f, e: evaluate(f, geoms) }));
  const plots = ev.flatMap(x => x.e.plots);
  const ha = plots.reduce((a, x) => a + (Number(x.p.area) || 0), 0);
  const cnt = s => ev.filter(x => x.e.status === s).length;
  const ver = cnt("verified"), hold = cnt("hold"), pend = cnt("pending");
  const agg = {};
  for (const x of ev) for (const i of [...x.e.issues, ...x.e.plots.flatMap(p => p.issues)]) { (agg[i.k] ||= { lv: i.lv, n: 0, sample: i }).n++; }
  const top = Object.values(agg).sort((a, b) => a.lv === b.lv ? b.n - a.n : a.lv === "bad" ? -1 : 1).slice(0, 8);
  const generic = i => ["i.overlap", "i.pt_in_poly", "i.in_other", "i.dup_pt", "i.same_id", "i.dup_name", "i.poly_req", "i.area_diff", "i.yield"].includes(i.k) && agg[i.k].n > 1 ? t(i.k, { ...i.p, p: "…", o: "…", a: "…", m: "…", y: "…" }) : issueText(i);
  const tt = (fr, en) => L === "fr" ? fr : en, n = live.length;
  const lead = n ? tt(`<b>${fmt(n)} producteur${n > 1 ? "s" : ""}</b> et ${fmt(plots.length)} parcelles (${fmt(ha, 1)} ha) au registre. ${fmt(ver)} vérifié${ver > 1 ? "s" : ""} (${Math.round(ver / n * 100)} %)${hold ? `, <b>${fmt(hold)} en attente</b> : leur cacao ne peut pas être livré` : ""}.`,
      `<b>${fmt(n)} farmer${n > 1 ? "s" : ""}</b> and ${fmt(plots.length)} plots (${fmt(ha, 1)} ha) in the registry. ${fmt(ver)} verified (${Math.round(ver / n * 100)}%)${hold ? `, <b>${fmt(hold)} on hold</b>: their cocoa cannot be released` : ""}.`)
    : tt("Le registre est vide : enregistrez le premier producteur.", "The registry is empty: register the first farmer.");
  const status = hold ? { lv: "bad", text: tt(`${hold} producteur${hold > 1 ? "s" : ""} en attente`, `${hold} farmer${hold > 1 ? "s" : ""} on hold`) } : pend ? { lv: "watch", text: tt(`${pend} à vérifier`, `${pend} to review`) } : { lv: "ok", text: tt("Registre à jour", "Registry up to date") };
  const head = window.UI ? UI.hero({ lang: L, status, name: (S.me && S.me.name) || t("ov.title"), role: S.me && S.me.role ? t("role." + S.me.role) : "", leadHtml: lead,
      actions: canWrite() ? `<button class="btn primary hero-cta" data-act="newFarmer">${UI.icon("farmer")}<span>${esc(t("btn.register"))}</span></button>` : "" })
    : `<div class="topline"><div><h1>${esc(t("ov.title"))}</h1><p>${esc(t("ov.sub"))}</p></div>
    <div class="row">${canWrite() ? `<button class="btn primary" data-act="newFarmer">${esc(t("btn.register"))}</button>` : ""}</div></div>`;
  if (!live.length) return head + emptyState();
  return head + `
  <div class="kpis">
    ${UI.kpi({ icon: "farmer", color: "var(--ok)", label: t("tile.farmers"), value: fmt(n), href: "#farmers", sub: t("tile.villages", { n: new Set(live.map(f => norm(f.village)).filter(Boolean)).size }) })}
    ${UI.kpi({ icon: "map", color: "var(--gold)", label: t("tile.plots"), value: fmt(plots.length), href: "#map", sub: `${fmt(ha, 1)} ha · ` + t("tile.plots_sub", { g: plots.filter(x => plotPoint(x.p)).length, p: plots.filter(x => hasPoly(x.p)).length }) })}
    ${UI.kpi({ icon: "tick", color: "var(--ok)", label: t("tile.verified"), value: fmt(ver), sub: t("tile.verified_sub", { p: Math.round(ver / n * 100) }) })}
    ${UI.kpi({ icon: "alert", color: "var(--bad)", label: t("tile.hold"), value: fmt(hold), sub: t("tile.hold_sub"), hot: hold > 0 })}
  </div>
  <div class="card stack"><h3>${esc(t("ov.status"))}</h3>
    <div class="bar" role="img" aria-label="${ver} / ${pend} / ${hold}"><span class="b-ok" style="width:${ver / live.length * 100}%"></span><span class="b-pend" style="width:${pend / live.length * 100}%"></span><span class="b-bad" style="width:${hold / live.length * 100}%"></span></div>
    <div class="legend"><span><i class="b-ok"></i>${esc(t("status.verified"))} ${ver}</span><span><i class="b-pend"></i>${esc(t("status.pending"))} ${pend}</span><span><i class="b-bad"></i>${esc(t("status.hold"))} ${hold}</span></div></div>
  <div class="grid2">
    <div class="card stack"><h3>${esc(t("ov.attention"))}</h3>
      ${top.length ? `<ul class="issues">${top.map(v => `<li class="${v.lv}"><b class="num">${v.n}×</b><span>${esc(generic(v.sample))}</span></li>`).join("")}</ul>` : `<ul class="issues"><li class="ok">${esc(t("ov.none"))}</li></ul>`}</div>
    <div class="card stack"><h3>${esc(t("ov.recent"))}</h3><div id="recentHost"><p class="empty">…</p></div></div>
  </div>
  <div class="card stack"><div class="topline"><h3>${esc(t("ov.all_plots"))}</h3><a href="#map">${esc(t("ov.open_map"))}</a></div>${mapSVG(geoms, { h: 300, link: true })}</div>`;
}
async function afterOverview() {
  const h = $("#recentHost"); if (!h) return;
  if (S.offline) { h.innerHTML = ""; return; }
  try {
    const rows = await S.api.recent(8);
    if (!$("#recentHost")) return;
    $("#recentHost").innerHTML = rows.length ? `<ul class="hist">${rows.map(r => { const f = S.farmers.find(x => x.id === r.farmerId); return `<li><a href="#farmer-${esc(r.farmerId)}"><b>${esc(f ? f.name : r.farmerId)}</b></a> <span class="mono">${esc(r.label)}</span><br><span class="when">${dtFmt(r.at)} · ${esc(S.people[r.by] || t("hist.someone"))}</span> · ${esc(histSummary(r))}</li>`; }).join("")}</ul>` : `<p class="empty">${esc(t("ov.no_changes"))}</p>`;
  } catch (e) { $("#recentHost").innerHTML = ""; }
}
function histSummary(r) {
  if (r.action === "created") return r.table === "plots" ? t("hist.plot_created", { p: r.label }) : t("hist.created");
  return r.ch.slice(0, 3).map(c => fl(c[0])).join(", ") + (r.ch.length > 3 ? "…" : "");
}
function emptyState() {
  return `<div class="card stack narrow"><h2>${esc(t("empty.title"))}</h2><p>${esc(t("empty.body"))}</p>
  ${canWrite() ? `<div><button class="btn primary" data-act="newFarmer">${esc(t("empty.cta"))}</button></div>` : ""}</div>`;
}

/* ---------- list ---------- */
function viewList() {
  const regions = [...new Set(S.farmers.flatMap(f => (f.plots || []).map(p => p.region)).filter(Boolean))].sort();
  return `<div class="topline"><div><h1>${esc(t("nav.farmers"))}</h1><p>${esc(t("list.sub"))}</p></div>
    <div class="row"><button class="btn" data-act="csv">${esc(t("btn.export_csv"))}</button>${canWrite() ? `<button class="btn primary" data-act="newFarmer">${esc(t("btn.register"))}</button>` : ""}</div></div>
  <div class="toolbar">
    <input type="search" id="q" placeholder="${esc(t("list.search"))}" value="${esc(S.q)}" aria-label="${esc(t("list.search"))}">
    <select id="fStatus" aria-label="${esc(t("col.status"))}"><option value="">${esc(t("list.all_status"))}</option>${["verified", "pending", "hold"].map(s => `<option value="${s}" ${S.fStatus === s ? "selected" : ""}>${esc(t("status." + s))}</option>`).join("")}</select>
    <select id="fRegion" aria-label="Region"><option value="">${esc(t("list.all_regions"))}</option>${regions.map(r => `<option ${S.fRegion === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
    <label class="row small-label"><input type="checkbox" id="showArch" ${S.showArchived ? "checked" : ""}> ${esc(t("list.show_archived"))}</label>
  </div><div id="listHost">${listTable()}</div>`;
}
function avatar(f, cls = "avatar") { const u = S.photos[f.photoPath]; return u ? `<img class="${cls}" src="${esc(u)}" alt="">` : `<span class="${cls}">${esc(initials(f.name))}</span>`; }
function listTable() {
  if (!S.farmers.length) return emptyState();
  const q = norm(S.q), geoms = allGeoms();
  const rows = S.farmers.filter(f => S.showArchived || !f.archived).map(f => ({ f, e: evaluate(f, geoms) }))
    .filter(({ f, e }) => (!S.fStatus || e.status === S.fStatus) && (!S.fRegion || (f.plots || []).some(p => p.region === S.fRegion)))
    .filter(({ f }) => !q || [f.name, f.id, f.village, f.phone, f.idNumber, f.supplierId, f.aliases].some(v => norm(v).includes(q)));
  if (!rows.length) return `<div class="card empty">${esc(t("list.none"))}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>${esc(t("col.farmer"))}</th><th>${esc(t("col.id"))}</th><th>${esc(t("col.village"))}</th><th>${esc(t("col.type"))}</th><th class="r">${esc(t("col.plots"))}</th><th class="r">${esc(t("col.area"))}</th><th>${esc(t("col.status"))}</th><th>${esc(t("col.issues"))}</th></tr></thead>
  <tbody>${rows.map(({ f, e }) => {
    const ha = (f.plots || []).reduce((a, p) => a + (Number(p.area) || 0), 0);
    const all = [...e.issues, ...e.plots.flatMap(x => x.issues)], nb = all.filter(i => i.lv === "bad").length, nw = all.length - nb;
    return `<tr data-id="${esc(f.id)}" tabindex="0"><td><div class="who">${avatar(f)}<div><b>${esc(f.name)}</b> ${f.example ? `<span class="tag">${esc(t("tag.example"))}</span>` : ""}<br><span class="muted small">${esc(f.phone || "")}</span></div></div></td>
      <td class="mono">${esc(f.id)}</td><td>${esc(f.village || "")}</td><td>${esc(f.type ? t("type." + f.type) : "")}</td>
      <td class="r num">${(f.plots || []).length}</td><td class="r num">${ha ? fmt(ha, 2) : ""}</td><td>${pill(e.status)}</td>
      <td class="small">${nb ? `<span class="t-bad">${esc(t("list.blocking", { n: nb }))}</span>` : ""}${nb && nw ? " · " : ""}${nw ? `<span class="t-warn">${esc(t("list.to_complete", { n: nw }))}</span>` : ""}${!nb && !nw ? `<span class="t-ok">${esc(t("list.no_issues"))}</span>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function bindList() {
  const upd = () => { $("#listHost").innerHTML = listTable(); };
  $("#q").oninput = e => { S.q = e.target.value; upd(); };
  $("#fStatus").onchange = e => { S.fStatus = e.target.value; upd(); };
  $("#fRegion").onchange = e => { S.fRegion = e.target.value; upd(); };
  $("#showArch").onchange = e => { S.showArchived = e.target.checked; upd(); };
  $("#listHost").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "farmer-" + tr.dataset.id; };
  $("#listHost").onkeydown = e => { const tr = e.target.closest("tr[data-id]"); if (tr && e.key === "Enter") location.hash = "farmer-" + tr.dataset.id; };
}

/* ---------- map ---------- */
function mapSVG(items, opt = {}) {
  const W = 800, H = opt.h || 360, geoms = allGeoms();
  const feats = items.map(({ f, p }) => ({ f, p, st: plotStatus(p, plotIssues(f, p, geoms)), poly: hasPoly(p) ? p.polygon : null, pt: plotPoint(p) })).filter(x => x.pt);
  if (!feats.length) return `<div class="map map-empty">${esc(t("map.empty"))}</div>`;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ft of feats) for (const c of (ft.poly || [ft.pt])) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
  const ms = 0.004; if (x1 - x0 < ms) { const c = (x0 + x1) / 2; x0 = c - ms / 2; x1 = c + ms / 2; } if (y1 - y0 < ms) { const c = (y0 + y1) / 2; y0 = c - ms / 2; y1 = c + ms / 2; }
  const cos = Math.cos((y0 + y1) / 2 * Math.PI / 180), pad = 36;
  const k = Math.min((W - 2 * pad) / ((x1 - x0) * cos), (H - 2 * pad) / (y1 - y0));
  const ox = (W - (x1 - x0) * cos * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const X = lon => ox + (lon - x0) * cos * k, Y = lat => oy + (y1 - lat) * k;
  const span = Math.max(x1 - x0, y1 - y0), st = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].find(s => span / s <= 6) || 5, dec = Math.max(0, -Math.floor(Math.log10(st)));
  let grid = "";
  for (let v = Math.ceil((x0 - pad / (cos * k)) / st) * st; X(v) < W; v += st) grid += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="0" y2="${H}"/><text class="glabel" x="${X(v) + 3}" y="${H - 4}">${v.toFixed(dec)}°</text>`;
  for (let v = Math.ceil((y0 - pad / k) / st) * st; Y(v) > 0; v += st) grid += `<line class="grid" y1="${Y(v)}" y2="${Y(v)}" x1="0" x2="${W}"/><text class="glabel" x="3" y="${Y(v) - 3}">${v.toFixed(dec)}°</text>`;
  const mPerPx = 111320 / k, len = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].find(n => n / mPerPx >= 60) || 100000, px = len / mPerPx;
  const scale = `<line class="scale" x1="${W - px - 16}" x2="${W - 16}" y1="${H - 18}" y2="${H - 18}"/><text class="stxt" x="${W - 16}" y="${H - 24}" text-anchor="end">${len >= 1000 ? len / 1000 + " km" : len + " m"}</text>`;
  const shapes = feats.map(ft => {
    let tiny = false; if (ft.poly) { const b = bbox(ft.poly); tiny = Math.max((b[2] - b[0]) * cos * k, (b[3] - b[1]) * k) < 10; }
    const tip = `<title>${esc(plotLabel(ft.f, ft.p))} · ${esc(ft.f.name)} · ${esc(t("status." + ft.st))}${ft.p.area ? ` · ${fmt(ft.p.area, 2)} ha` : ""}</title>`;
    const shape = ft.poly && !tiny ? `<polygon class="poly ${ft.st}" points="${ft.poly.map(c => X(c[0]).toFixed(1) + "," + Y(c[1]).toFixed(1)).join(" ")}"/>` : `<circle class="pt ${ft.st}" cx="${X(ft.pt[0])}" cy="${Y(ft.pt[1])}" r="6"/>`;
    const g = `${shape}<text class="lab" x="${X(ft.pt[0])}" y="${Y(ft.pt[1]) - (ft.poly && !tiny ? 0 : 10)}" text-anchor="middle">${esc(opt.short ? ft.p.pid : plotLabel(ft.f, ft.p))}</text>`;
    return opt.link ? `<a class="hit" href="#farmer-${esc(ft.f.id)}">${tip}${g}</a>` : `<g>${tip}${g}</g>`;
  }).join("");
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${feats.length} plots">${grid}${shapes}${scale}</svg>
  <div class="legend"><span><i class="b-ok"></i>${esc(t("status.verified"))}</span><span><i class="b-pod"></i>${esc(t("status.pending"))}</span><span><i class="b-bad"></i>${esc(t("status.hold"))}</span><span>${esc(t("map.legend"))}</span></div>`;
}
function viewMap() {
  const g = allGeoms(), geoKeys = /^i\.(overlap|pt_in_poly|in_other|dup_pt|swapped|outside|no_geo|poly_req|decimals)$/;
  const probs = g.flatMap(x => plotIssues(x.f, x.p, g).filter(i => geoKeys.test(i.k)).map(i => ({ ...x, i })));
  return `<div class="topline"><div><h1>${esc(t("nav.map"))}</h1><p>${esc(t("map.sub", { p: g.length, f: new Set(g.map(x => x.f.id)).size }))}</p></div>
    <div class="row"><button class="btn" data-act="geojson">${esc(t("btn.export_geojson"))}</button></div></div>
  <div class="card">${mapSVG(g, { h: 520, link: true })}</div>
  <div class="card stack"><h3>${esc(t("map.problems"))}</h3>${probs.length ? `<ul class="issues">${probs.map(x => `<li class="${x.i.lv}"><a class="mono" href="#farmer-${esc(x.f.id)}">${esc(plotLabel(x.f, x.p))}</a><span>${esc(issueText(x.i))}</span></li>`).join("")}</ul>` : `<ul class="issues"><li class="ok">${esc(t("map.ok"))}</li></ul>`}</div>`;
}

/* ---------- profile ---------- */
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === undefined || v === null || v === "" ? `<span class="empty">${esc(t("not_recorded"))}</span>` : v}</dd>`).join("")}</dl>`;
const tx = v => v ? esc(v) : "";
const chk = (on, k) => `<span class="${on ? "y" : "n"}">${esc(t(k))}</span>`;
function issueList(iss, okKey) {
  if (!iss.length) return `<ul class="issues"><li class="ok">${esc(t(okKey))}</li></ul>`;
  return `<ul class="issues">${iss.slice().sort((a, b) => a.lv === b.lv ? 0 : a.lv === "bad" ? -1 : 1).map(i => `<li class="${i.lv}"><span>${esc(issueText(i))}</span></li>`).join("")}</ul>`;
}
function viewProfile(f) {
  const e = evaluate(f), ha = (f.plots || []).reduce((a, p) => a + (Number(p.area) || 0), 0), ed = canWrite() && !f.archived;
  const u = S.photos[f.photoPath];
  return `<div><a href="#farmers">${esc(t("pro.back"))}</a></div>
  ${f.archived ? `<div class="notice">${esc(t("pro.archived", { r: f.archiveReason ? ": " + f.archiveReason : "", id: f.id }))}</div>` : ""}
  <div class="card pro-head">
    ${u ? `<img class="photo" src="${esc(u)}" alt="">` : `<div class="photo" aria-hidden="true">${esc(initials(f.name))}</div>`}
    <div class="pro-id">
      <div class="row">${pill(e.status)} ${f.type ? `<span class="muted">${esc(t("type." + f.type))}</span>` : ""} ${f.example ? `<span class="tag">${esc(t("tag.example"))}</span>` : ""}</div>
      <h1>${esc(f.name)}</h1>
      <div class="ids"><span>ID <b class="mono">${esc(f.id)}</b></span>${f.supplierId ? `<span>${esc(fl("supplierId"))} <b class="mono">${esc(f.supplierId)}</b></span>` : ""}<span>${esc([f.village, (f.plots || [])[0]?.region].filter(Boolean).join(", "))}</span></div>
      <div class="ids"><span class="num">${esc(t("pro.plots_n", { n: (f.plots || []).length }))}</span><span class="num">${esc(t("pro.ha", { n: fmt(ha, 2) }))}</span>${f.phone ? `<span>${esc(t("pro.tel", { n: f.phone }))}</span>` : ""}</div>
      <div class="row">
        ${ed ? `<button class="btn primary small" data-act="editFarmer" data-id="${esc(f.id)}">${esc(t("btn.edit_farmer"))}</button><button class="btn small" data-act="newPlot" data-id="${esc(f.id)}">${esc(t("btn.add_plot"))}</button>` : ""}
        ${canWrite() ? `<button class="btn small" data-act="archive" data-id="${esc(f.id)}">${esc(t(f.archived ? "btn.restore" : "btn.archive"))}</button>` : ""}
      </div>
    </div>
    <div class="qr"><div id="qrBox"></div><small>${esc(f.id)}</small><button class="btn small qr-btn" data-act="qr" data-id="${esc(f.id)}">${esc(t("btn.save_qr"))}</button></div>
  </div>
  <div class="grid2">
    <div class="stack">
      <div class="card stack"><h3>${esc(t("pro.issues"))}</h3>${issueList(e.issues, "pro.identity_ok")}</div>
      <div class="card stack"><h3>${esc(t("pro.identity"))}</h3>${kv([
        [fl("name"), tx(f.name)], [fl("aliases"), tx(f.aliases)], [fl("gender"), f.gender ? esc(t("gender." + f.gender)) : ""],
        [fl("village"), tx(f.village)], [fl("address"), tx(f.address)], [fl("phone"), tx(f.phone)], [fl("email"), tx(f.email)],
        [fl("idType"), esc([f.idType, f.idNumber].filter(Boolean).join(" · "))], [fl("idValidity"), dateFmt(f.idValidity)], [fl("idViewedOn"), dateFmt(f.idViewedOn)],
        [fl("idCheckedBy"), tx(f.idCheckedBy)], [fl("idVerifRef"), tx(f.idVerifRef)], [fl("niu"), tx(f.niu)], [fl("representative"), tx(f.representative)]])}</div>
      <div class="card stack"><h3>${esc(t("pro.verif"))}</h3>
        ${kv([[fl("confirmDate"), dateFmt(f.confirmDate)], [fl("officer"), tx(f.officer)], [fl("recordRef"), tx(f.recordRef)]])}
        <div class="checks">${chk(f.chkIdentity, "chk.identity")}${chk(f.chkRep, "chk.rep")}${chk(f.chkPlots, "chk.plots")}</div>
        ${kv([[fl("issues"), tx(f.issues)], [fl("reviewer"), tx(f.reviewer)], [fl("decision"), f.decision ? `<b>${esc(t("dec." + f.decision))}</b>` : ""], [fl("decisionDate"), dateFmt(f.decisionDate)]])}</div>
      <div class="card stack"><h3>${esc(t("pro.history"))}</h3><div id="histHost"><p class="empty">…</p></div></div>
    </div>
    <div class="stack">
      <div class="card stack"><h3>${esc(t("pro.mapping"))}</h3>${mapSVG((f.plots || []).map(p => ({ f, p })), { h: 280, short: true })}</div>
      ${(f.plots || []).length ? e.plots.map(x => plotCard(f, x, ed)).join("") : `<div class="card empty">${esc(t("pro.no_plots"))} ${ed ? `<button class="btn small" data-act="newPlot" data-id="${esc(f.id)}">${esc(t("pro.first_plot"))}</button>` : ""}</div>`}
    </div>
  </div>`;
}
function plotCard(f, { p, issues, status }, ed) {
  const pt = plotPoint(p), poly = hasPoly(p);
  const osm = pt ? `https://www.openstreetmap.org/?mlat=${pt[1]}&mlon=${pt[0]}#map=17/${pt[1]}/${pt[0]}` : "";
  const dec = p.decision ? `<b>${esc(t("dec." + p.decision))}</b>${p.reviewer ? " " + t("plot.by") + " " + esc(p.reviewer) : ""}${p.decisionDate ? " " + t("plot.on") + " " + dateFmt(p.decisionDate) : ""}` : "";
  return `<div class="plot"><div class="plot-head"><div><b class="mono">${esc(plotLabel(f, p))}</b> ${pill(status)}
      <div class="plot-meta"><span>${p.area ? fmt(p.area, 2) + " ha" : esc(t("plot.area_missing"))}</span>${poly ? `<span>${esc(t("plot.polygon_info", { n: p.polygon.length, ha: fmt(polyAreaHa(p.polygon), 2) }))}</span>` : pt ? `<span>${esc(t("plot.gps"))}</span>` : ""}<span>${esc([p.village, p.arrondissement, p.region].filter(Boolean).join(", "))}</span></div></div>
      <div class="row">${osm ? `<a class="btn small" href="${osm}" target="_blank" rel="noopener">${esc(t("plot.osm"))}</a>` : ""}${ed ? `<button class="btn small" data-act="editPlot" data-id="${esc(f.id)}" data-pid="${esc(p.pid)}">${esc(t("btn.edit_plot"))}</button>` : ""}</div></div>
    <div class="plot-body"><div class="stack">${issueList(issues, "plot.ok")}
      <div class="checks">${chk(p.chkFormat, "chk.format")}${chk(p.chkLink, "chk.link")}${chk(p.chkRisk, "chk.risk")}</div></div>
      <div>${kv([
        [t("plot.coords"), isNum(p.lat) && isNum(p.lon) ? `<span class="mono">${esc(p.lat)}, ${esc(p.lon)}</span>` : poly ? `<span class="mono">${esc(t("plot.centre"))} ${pt[1].toFixed(6)}, ${pt[0].toFixed(6)}</span>` : ""],
        [fl("harvest"), tx(p.harvest)], [fl("expectedKg"), p.expectedKg ? fmt(p.expectedKg) + " kg" : ""],
        [t("plot.mapping"), esc([dateFmt(p.mapDate), p.provider].filter(Boolean).join(" · "))], [t("plot.file"), esc([p.fileName, p.fileVersion && "v" + p.fileVersion].filter(Boolean).join(" · "))],
        [t("plot.defo"), esc([dateFmt(p.defoDate), p.defoEvidence].filter(Boolean).join(" · "))], [t("plot.decision"), dec]])}
        <details><summary>${esc(t("plot.all_fields"))}</summary>${kv([
          [fl("producer"), tx(p.producer)], [fl("country"), tx(p.country)], [fl("region"), tx(p.region)], [fl("department"), tx(p.department)], [fl("arrondissement"), tx(p.arrondissement)], [fl("village"), tx(p.village)],
          [fl("estBasis"), tx(p.estBasis)], [fl("rightEvidence"), tx(p.rightEvidence)], [fl("linkEvidence"), tx(p.linkEvidence)], [fl("overlapRef"), tx(p.overlapRef)],
          [t("plot.legal"), esc([dateFmt(p.legalDate), p.legalEvidence].filter(Boolean).join(" · "))], [fl("concerns"), tx(p.concerns)], [fl("nextCheck"), tx(p.nextCheck)]])}</details>
      </div></div></div>`;
}
function fmtVal(k, v) {
  if (v === null || v === undefined || v === "") return t("hist.cleared");
  if (k === "polygon") return Array.isArray(v) ? `${v.length} pts, ${fmt(polyAreaHa(v), 2)} ha` : String(v);
  if (k === "photoPath") return t("hist.photo");
  if (typeof v === "boolean") return v ? "✓" : "○";
  return String(v).slice(0, 160);
}
async function afterProfile(f) {
  const box = $("#qrBox");
  if (box && window.QRCode) { try { new QRCode(box, { text: `SAIC|${f.id}|${f.name || ""}`, width: 112, height: 112, colorDark: "#1b2420", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); } catch (e) {} }
  else if (box) box.innerHTML = `<b class="mono qr-fallback">${esc(f.id)}</b>`;
  if (S.offline) { $("#histHost").innerHTML = ""; return; }
  try {
    const h = await S.api.history(f.id);
    const host = $("#histHost"); if (!host || route() !== "farmer-" + f.id) return;
    host.innerHTML = h.length ? `<ul class="hist">${h.map(x => `<li><span class="when">${dtFmt(x.at)} · ${esc(S.people[x.by] || t("hist.someone"))}</span><br>${x.action === "created" ? esc(x.table === "plots" ? t("hist.plot_created", { p: x.label }) : t("hist.created")) : x.ch.map(c => `${x.table === "plots" ? `<span class="mono">${esc(x.label.split(" ")[1] || "")}</span> · ` : ""}${esc(fl(c[0]))}: ${c[1] !== null && c[1] !== "" ? `<code>${esc(fmtVal(c[0], c[1]))}</code> → ` : ""}<code>${esc(fmtVal(c[0], c[2]))}</code>`).join("<br>")}</li>`).join("")}</ul>` : `<p class="empty">${esc(t("hist.none"))}</p>`;
  } catch (e) { const host = $("#histHost"); if (host) host.innerHTML = ""; }
}

/* ---------- team ---------- */
function viewTeam() {
  const ps = S.profiles || (S.api.mode === "demo" ? [{ id: "demo", full_name: "Demo user", role: "lead" }] : []);
  return `<div class="topline"><div><h1>${esc(t("team.title"))}</h1><p>${esc(t("team.sub"))}</p></div></div>
  ${!isLead() ? `<div class="notice info">${esc(t("team.only_lead"))}</div>` : ""}
  <div class="table-wrap"><table><thead><tr><th>${esc(t("team.name"))}</th><th>${esc(t("team.role"))}</th></tr></thead><tbody class="no-click">
  ${ps.map(p => `<tr><td>${esc(p.full_name || "—")} ${S.me && p.id === S.me.id ? `<span class="muted">(${esc(t("team.you"))})</span>` : ""}</td>
    <td>${isLead() && p.id !== S.me.id && !S.offline ? `<select data-role="${esc(p.id)}" aria-label="${esc(t("team.role"))}">${["lead", "warehouse", "viewer"].map(r => `<option value="${r}" ${p.role === r ? "selected" : ""}>${esc(t("role." + r))}</option>`).join("")}</select>` : esc(t("role." + p.role))}</td></tr>`).join("")}
  </tbody></table></div>`;
}
function bindTeam() {
  document.querySelectorAll("select[data-role]").forEach(s => s.onchange = async () => {
    try { await S.api.setRole(s.dataset.role, s.value); await loadPeople(); toast(t("toast.saved")); } catch (e) { toast(t("toast.save_fail", { msg: e.message })); }
  });
}

/* ---------- forms ---------- */
function fld(id, lbl, val, o = {}) {
  const type = o.type || "text", full = o.full ? " full" : "", dis = o.disabled ? " disabled" : "";
  let inp;
  if (type === "select") inp = `<select id="${id}" name="${id}"${dis}>${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(val || "") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (type === "textarea") inp = `<textarea id="${id}" name="${id}"${dis} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""}>${esc(val || "")}</textarea>`;
  else inp = `<input id="${id}" name="${id}" type="${type}" value="${esc(val ?? "")}"${dis} ${o.list ? `list="${o.list}"` : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""} ${o.step ? `step="${o.step}"` : ""} ${o.mode ? `inputmode="${o.mode}"` : ""}>`;
  return `<div class="f${full}"><label for="${id}">${esc(lbl)}${o.req ? " *" : ""}</label>${inp}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ""}</div>`;
}
const F = (k, v, o) => fld(k, fl(k), v, o);
const cbx = (id, k, on) => `<label class="cb"><input type="checkbox" id="${id}" name="${id}" ${on ? "checked" : ""}><span>${esc(t(k))}</span></label>`;
const opts = (arr, prefix) => arr.map(v => [v, prefix ? t(prefix + v) : (v || "—")]);
function closeModal() { $("#modal").innerHTML = ""; document.removeEventListener("keydown", escClose); }
function escClose(e) { if (e.key === "Escape") closeModal(); }
function showModal(html) {
  $("#modal").innerHTML = `<div class="scrim"><div class="drawer" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#modal .scrim").onclick = e => { if (e.target.classList.contains("scrim")) closeModal(); };
  $("#modal").querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
  document.addEventListener("keydown", escClose);
  const first = $("#modal input:not([type=file]), #modal select"); if (first) first.focus();
}
function readForm(form) { const o = {}; for (const el of form.elements) { if (!el.name || el.disabled) continue; o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim(); } return o; }
const head = (title, sub) => `<header><div><h2>${title}</h2><p>${sub}</p></div><button type="button" class="btn" data-close>${esc(t("form.close"))}</button></header>`;
const foot = (label, errId) => `<footer><span class="err" id="${errId}"></span><div class="row"><button type="button" class="btn" data-close>${esc(t("form.cancel"))}</button><button type="submit" class="btn primary" id="${errId}Btn">${esc(label)}</button></div></footer>`;

let pendingPhoto;
function openFarmerForm(id) {
  const f = id ? S.farmers.find(x => x.id === id) : { type: "Farmer" };
  const lead = isLead(); pendingPhoto = undefined;
  const u = S.photos[f.photoPath];
  showModal(`<form id="ff" novalidate>
    ${head(id ? esc(t("form.edit_title", { n: f.name })) : esc(t("form.reg_title")), id ? `F01 · <span class="mono">${esc(id)}</span>` : esc(t("form.id_assigned")))}
    <div class="body">
      <fieldset><legend>${esc(t("form.photo"))}</legend>
        <div class="photo-pick"><div id="photoPrev">${u ? `<img class="photo" src="${esc(u)}" alt="">` : `<div class="photo">${esc(initials(f.name))}</div>`}</div>
        <div class="stack"><input type="file" id="photoIn" accept="image/*" aria-label="${esc(t("form.photo"))}"><span class="hint">${esc(t("form.photo_hint"))}</span></div></div>
      </fieldset>
      <fieldset><legend>${esc(t("form.s_identity"))}</legend>
        ${F("name", f.name, { req: true, full: true })}
        ${F("type", f.type, { type: "select", options: opts(TYPES, "type.") })}
        ${F("supplierId", f.supplierId, { ph: "S0001", hint: t("form.supplier_hint") })}
        ${F("gender", f.gender, { type: "select", options: opts(["", "Female", "Male"], "gender.") })}
        ${F("aliases", f.aliases)}
        ${F("village", f.village, { req: true })}
        ${F("address", f.address)}
        ${F("phone", f.phone, { type: "tel", ph: "+237 6…" })}
        ${F("email", f.email, { type: "email" })}
      </fieldset>
      <fieldset><legend>${esc(t("form.s_iddoc"))}</legend>
        ${F("idType", f.idType, { type: "select", options: opts(ID_TYPES) })}
        ${F("idNumber", f.idNumber)}
        ${F("idValidity", f.idValidity, { type: "date" })}
        ${F("idViewedOn", f.idViewedOn, { type: "date" })}
        ${F("idCheckedBy", f.idCheckedBy)}
        ${F("idVerifRef", f.idVerifRef)}
        ${F("niu", f.niu, { hint: t("form.niu_hint") })}
        ${F("representative", f.representative, { hint: t("form.rep_hint") })}
      </fieldset>
      <fieldset><legend>${esc(t("form.s_confirm"))}</legend>
        ${F("confirmDate", f.confirmDate, { type: "date" })}
        ${F("officer", f.officer)}
        ${F("recordRef", f.recordRef)}
        ${cbx("chkIdentity", "chk.identity", f.chkIdentity)}${cbx("chkRep", "chk.rep", f.chkRep)}${cbx("chkPlots", "chk.plots", f.chkPlots)}
        ${F("issues", f.issues, { type: "textarea", full: true })}
        ${lead ? "" : `<p class="hint full">${esc(t("form.lead_only"))}</p>`}
        ${F("reviewer", f.reviewer, { disabled: !lead })}
        ${F("decision", f.decision, { type: "select", options: opts(DECISIONS, "dec."), disabled: !lead })}
        ${F("decisionDate", f.decisionDate, { type: "date", disabled: !lead })}
      </fieldset>
    </div>${foot(id ? t("form.save") : t("btn.register"), "ffErr")}</form>`);
  $("#photoIn").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { pendingPhoto = await resizeImage(file, 600, 0.82); $("#photoPrev").innerHTML = `<img class="photo" src="${URL.createObjectURL(pendingPhoto)}" alt="">`; }
    catch (x) { $("#ffErr").textContent = t("form.bad_image"); }
  };
  $("#ff").onsubmit = async e => {
    e.preventDefault();
    const v = readForm(e.target);
    if (!v.name || !v.village) { $("#ffErr").textContent = t("form.need_name"); return; }
    const btn = $("#ffErrBtn"); btn.disabled = true; btn.textContent = t("form.saving");
    try {
      let rec;
      if (id) {
        const patch = {}; for (const [k, val] of Object.entries(v)) if ((f[k] ?? "") !== val) patch[k] = val;
        if (pendingPhoto) patch.photoPath = await S.api.uploadPhoto(id, pendingPhoto);
        rec = Object.keys(patch).length ? await S.api.updateFarmer(id, patch) : f;
      } else {
        rec = await S.api.createFarmer(v);
        if (pendingPhoto) rec = await S.api.updateFarmer(rec.id, { photoPath: await S.api.uploadPhoto(rec.id, pendingPhoto) });
      }
      replaceFarmer(rec); closeModal();
      toast(id ? t("toast.saved") : t("toast.registered", { id: rec.id }));
      if (!id) location.hash = "farmer-" + rec.id; else render();
      loadPhotos([rec.photoPath]);
    } catch (x) { btn.disabled = false; btn.textContent = id ? t("form.save") : t("btn.register"); $("#ffErr").textContent = t("toast.save_fail", { msg: x.message }); }
  };
}
function resizeImage(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error("image")), "image/jpeg", q); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image")); };
    img.src = url;
  });
}
function openPlotForm(fid, pid) {
  const f = S.farmers.find(x => x.id === fid), lead = isLead();
  const existing = pid ? f.plots.find(p => p.pid === pid) : null;
  const n = (f.plots || []).reduce((m, p) => Math.max(m, parseInt(p.pid.slice(1), 10) || 0), 0) + 1;
  const prev = (f.plots || [])[f.plots.length - 1] || {};
  const p = existing || { pid: "P" + String(n).padStart(2, "0"), producer: f.name, country: "Cameroon", region: prev.region || "", department: prev.department || "", arrondissement: prev.arrondissement || "", village: prev.village || f.village || "" };
  const polyText = hasPoly(p) ? JSON.stringify({ type: "Polygon", coordinates: [[...p.polygon, p.polygon[0]]] }) : "";
  showModal(`<form id="pf" novalidate>
    ${head(`${esc(t(existing ? "form.edit_plot" : "form.add_plot"))} <span class="mono">${esc(f.id)} ${esc(p.pid)}</span>`, `F01 B · ${esc(f.name)}`)}
    <div class="body">
      <fieldset><legend>${esc(t("form.s_location"))}</legend>
        ${F("producer", p.producer)}${F("country", p.country)}${F("region", p.region, { list: "regions" })}${F("department", p.department)}${F("arrondissement", p.arrondissement)}${F("village", p.village)}
        <datalist id="regions">${REGIONS.map(r => `<option value="${r}">`).join("")}</datalist></fieldset>
      <fieldset><legend>${esc(t("form.s_size"))}</legend>
        ${F("area", p.area, { type: "number", step: "0.01", mode: "decimal", hint: t("form.area_hint", { t: POLYGON_THRESHOLD_HA }) })}
        ${F("harvest", p.harvest, { ph: t("form.harvest_ph") })}
        ${F("expectedKg", p.expectedKg, { type: "number", step: "1", mode: "numeric" })}
        ${F("estBasis", p.estBasis)}</fieldset>
      <fieldset><legend>${esc(t("form.s_geo"))}</legend>
        ${F("lat", p.lat, { mode: "decimal", ph: "4.123456", hint: t("form.lat_hint", { d: MIN_DECIMALS }) })}
        ${F("lon", p.lon, { mode: "decimal", ph: "11.512345", hint: t("form.lon_hint") })}
        <div class="f full"><button type="button" class="btn small" id="gpsBtn">${esc(t("form.use_gps"))}</button></div>
        <div class="f full"><label for="polyText">${esc(fl("polygon"))}</label>
          <textarea id="polyText" name="polyText" class="mono-area" placeholder="${esc(t("form.poly_ph"))}">${esc(polyText)}</textarea>
          <div class="row"><input type="file" id="polyFile" accept=".geojson,.json,.kml,.txt,.csv" aria-label="${esc(t("form.poly_import"))}"><span id="polyInfo" class="hint"></span></div></div>
        ${F("fileName", p.fileName)}${F("fileVersion", p.fileVersion)}${F("mapDate", p.mapDate, { type: "date" })}${F("provider", p.provider)}</fieldset>
      <fieldset><legend>${esc(t("form.s_evidence"))}</legend>
        ${F("rightEvidence", p.rightEvidence, { full: true, hint: t("form.right_hint") })}${F("linkEvidence", p.linkEvidence, { full: true })}${F("overlapRef", p.overlapRef, { full: true })}
        ${F("defoEvidence", p.defoEvidence, { hint: t("form.defo_hint") })}${F("defoDate", p.defoDate, { type: "date" })}${F("legalEvidence", p.legalEvidence)}${F("legalDate", p.legalDate, { type: "date" })}</fieldset>
      <fieldset><legend>${esc(t("form.s_review"))}</legend>
        ${cbx("chkFormat", "chk.format", p.chkFormat)}${cbx("chkLink", "chk.link", p.chkLink)}${cbx("chkRisk", "chk.risk", p.chkRisk)}
        ${F("concerns", p.concerns, { type: "textarea", full: true })}
        ${lead ? "" : `<p class="hint full">${esc(t("form.lead_only"))}</p>`}
        ${F("reviewer", p.reviewer, { disabled: !lead })}${F("decision", p.decision, { type: "select", options: opts(DECISIONS, "dec."), disabled: !lead })}${F("decisionDate", p.decisionDate, { type: "date", disabled: !lead })}
        ${F("nextCheck", p.nextCheck)}</fieldset>
    </div>${foot(t(existing ? "form.save_plot" : "form.add_plot"), "pfErr")}</form>`);
  const info = () => { const r = parseGeometry($("#polyText").value); const el = $("#polyInfo"); el.textContent = r.error ? r.error : r.polygon ? t("form.poly_info", { n: r.polygon.length, ha: fmt(polyAreaHa(r.polygon), 2) }) + (r.note ? " · " + r.note : "") : ""; el.classList.toggle("err", !!r.error); };
  info();
  $("#polyText").oninput = info;
  $("#polyFile").onchange = async e => { const file = e.target.files[0]; if (!file) return; $("#polyText").value = await file.text(); if (!$("#fileName").value) $("#fileName").value = file.name; info(); };
  $("#gpsBtn").onclick = () => {
    if (!navigator.geolocation) { $("#pfErr").textContent = t("form.gps_fail", { msg: "—" }); return; }
    navigator.geolocation.getCurrentPosition(pos => { $("#lat").value = pos.coords.latitude.toFixed(6); $("#lon").value = pos.coords.longitude.toFixed(6); if (!$("#mapDate").value) $("#mapDate").value = today(); },
      err => { $("#pfErr").textContent = t("form.gps_fail", { msg: err.message }); }, { enableHighAccuracy: true, timeout: 20000 });
  };
  $("#pf").onsubmit = async e => {
    e.preventDefault();
    const v = readForm(e.target);
    const g = parseGeometry(v.polyText); delete v.polyText;
    if (g.error) { $("#pfErr").textContent = fl("polygon") + ": " + g.error; return; }
    if (g.point) { v.lat = v.lat || g.point.lat; v.lon = v.lon || g.point.lon; }
    for (const k of ["lat", "lon"]) { v[k] = v[k].replace(",", "."); if (v[k] && !isNum(v[k])) { $("#pfErr").textContent = t("form.coord_bad", { f: fl(k) }); return; } }
    const body = { ...v, pid: p.pid, polygon: g.polygon || null };
    if (existing) { body.id = existing.id; for (const k of Object.keys(body)) if (k !== "id" && k !== "pid" && JSON.stringify(existing[k] ?? "") === JSON.stringify(body[k] ?? "")) delete body[k]; }
    const btn = $("#pfErrBtn"); btn.disabled = true; btn.textContent = t("form.saving");
    try { replaceFarmer(await S.api.savePlot(f.id, body)); closeModal(); toast(existing ? t("toast.plot_saved") : t("toast.plot_added", { p: p.pid })); render(); }
    catch (x) { btn.disabled = false; btn.textContent = t(existing ? "form.save_plot" : "form.add_plot"); $("#pfErr").textContent = t("toast.save_fail", { msg: x.message }); }
  };
}
async function toggleArchive(id) {
  const f = S.farmers.find(x => x.id === id);
  if (f.archived) { try { replaceFarmer(await S.api.updateFarmer(id, { archived: false, archiveReason: "" })); render(); } catch (x) { toast(t("toast.save_fail", { msg: x.message })); } return; }
  showModal(`<form id="af" novalidate>${head(esc(t("arch.title", { n: f.name })), esc(t("arch.sub", { id: f.id })))}
    <div class="body"><fieldset>${fld("archiveReason", t("arch.reason"), "", { full: true, req: true, ph: t("arch.ph") })}</fieldset></div>${foot(t("btn.archive"), "afErr")}</form>`);
  $("#af").onsubmit = async e => {
    e.preventDefault(); const r = $("#archiveReason").value.trim(); if (!r) { $("#afErr").textContent = t("arch.need"); return; }
    try { replaceFarmer(await S.api.updateFarmer(id, { archived: true, archiveReason: r })); closeModal(); render(); } catch (x) { $("#afErr").textContent = t("toast.save_fail", { msg: x.message }); }
  };
}

/* ---------- export ---------- */
function download(filename, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportCSV() {
  const cols = ["farmer_id", "supplier_id", "name", "type", "gender", "village", "phone", "id_type", "id_number", "plot_id", "region", "department", "arrondissement", "area_ha", "lat", "lon", "polygon_corners", "mapped_ha", "harvest", "farmer_status", "plot_status", "plot_decision"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, rows = [cols.join(",")], geoms = allGeoms();
  for (const f of S.farmers.filter(f => !f.archived)) {
    const e = evaluate(f, geoms);
    for (const { p, status } of (e.plots.length ? e.plots : [{ p: {}, status: "" }])) {
      const pt = plotPoint(p);
      rows.push([f.id, f.supplierId, f.name, f.type, f.gender, f.village, f.phone, f.idType, f.idNumber, p.pid ? f.id + " " + p.pid : "", p.region, p.department, p.arrondissement, p.area, p.lat || (pt ? pt[1].toFixed(6) : ""), p.lon || (pt ? pt[0].toFixed(6) : ""), hasPoly(p) ? p.polygon.length : "", hasPoly(p) ? polyAreaHa(p.polygon).toFixed(2) : "", p.harvest, e.status, status, p.decision].map(q).join(","));
    }
  }
  download(`saic-farmers-${today()}.csv`, "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
}
function exportGeoJSON() {
  const feats = allGeoms().filter(({ p }) => plotPoint(p)).map(({ f, p }) => ({
    type: "Feature",
    properties: { plot_id: `${f.id} ${p.pid}`, farmer_id: f.id, farmer: f.name, country: p.country, region: p.region, area_ha: Number(p.area) || null, harvest: p.harvest || null, file_version: p.fileVersion || null, mapping_date: p.mapDate || null },
    geometry: hasPoly(p) ? { type: "Polygon", coordinates: [[...p.polygon, p.polygon[0]]] } : { type: "Point", coordinates: [Number(p.lon), Number(p.lat)] }
  }));
  download(`saic-plots-${today()}.geojson`, JSON.stringify({ type: "FeatureCollection", features: feats }, null, 1), "application/geo+json");
}
function saveQR(id) { const c = $("#qrBox canvas"); if (!c) return; c.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${id}-qr.png`; a.click(); }); }

/* ---------- actions ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "newFarmer") openFarmerForm();
  else if (a === "editFarmer") openFarmerForm(id);
  else if (a === "newPlot") openPlotForm(id);
  else if (a === "editPlot") openPlotForm(id, b.dataset.pid);
  else if (a === "archive") toggleArchive(id);
  else if (a === "csv") exportCSV();
  else if (a === "geojson") exportGeoJSON();
  else if (a === "qr") saveQR(id);
});

/* ---------- start ---------- */
async function start() {
  S.me = await S.api.me().catch(() => null);
  if (!S.me && !navigator.onLine) { try { S.me = JSON.parse(localStorage.getItem("saic-me")); } catch (e) {} }
  if (!S.me) { render(); return; }
  if (S.api.mode === "live") { try { localStorage.setItem("saic-me", JSON.stringify(S.me)); } catch (e) {} }
  S.loaded = false; render();
  await loadPeople();
  await loadAll();
}
(async () => {
  render();
  try {
    S.api = await createApi();
  } catch (e) {
    $("#main").innerHTML = `<div class="notice">${esc(t("load.error", { msg: e.message }))}</div>`; return;
  }
  S.api.onRecovery(() => { recovery = true; S.me = null; render(); });
  const sess = await S.api.session().catch(() => null);
  if (sess || (!navigator.onLine && localStorage.getItem("saic-me"))) await start(); else render();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
