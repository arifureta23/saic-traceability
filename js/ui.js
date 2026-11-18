/* SAIC Suite UI kit: the "Cacao Night" building blocks shared by every dashboard
   (greeting hero, KPI cards with sparklines, cocoa chart, gauges, attention feed,
   request rows, sidebar icons). Plain script: exposes window.UI. Styles: css/theme.css. */
(function () {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = l => l === "en" ? "en-GB" : "fr-FR";
  const num = (n, l, d = 0) => Number(n || 0).toLocaleString(loc(l), { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, " ");

  const IC = {
    check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    tick: '<path d="M5 12l5 5 9-10"/>',
    pod: '<path d="M12 3c4 3 6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 2-7 6-10z"/><path d="M12 7v13"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    cash: '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    grid: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    apps: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1.5 3h5L16 13h5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 7h.01"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    farmer: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M7 7h10"/>'
  };
  const icon = (k, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.grid}</svg>`;

  const greetKey = () => { const h = new Date().getHours(); return h < 12 ? "m" : h < 18 ? "a" : "e"; };
  const greet = l => ({ fr: { m: "Bonjour", a: "Bonjour", e: "Bonsoir" }, en: { m: "Good morning", a: "Good afternoon", e: "Good evening" } })[l === "en" ? "en" : "fr"][greetKey()];
  const today = l => new Date().toLocaleDateString(loc(l), { weekday: "long", day: "numeric", month: "long" });

  /* Greeting hero: eyebrow (status · date), "Bonsoir, <Name>", one-sentence update, call to action. */
  function hero(o) {
    const st = o.status ? `<span class="st ${o.status.lv}">${esc(o.status.text)}</span><span>·</span>` : "";
    return `<section class="hero ui-rise">
      <div><div class="eyebrow">${st}<span>${esc(today(o.lang))}</span>${o.badge ? `<span>·</span>${o.badge}` : ""}</div>
        <h1>${esc(greet(o.lang))}, <em>${esc(o.name)}</em></h1>
        ${o.role ? `<p class="hero-role">${esc(o.role)}</p>` : ""}
        <p class="lead">${o.leadHtml || esc(o.lead || "")}</p></div>
      ${o.actions ? `<div class="row hero-actions">${o.actions}</div>` : ""}${o.cta ? `<a class="btn primary hero-cta" href="${esc(o.cta.href)}" ${o.cta.attr || ""}>${icon(o.cta.icon || "tick", 2.4)}<span>${esc(o.cta.label)}</span></a>` : ""}
    </section>`;
  }

  /* Sparkline (inline SVG, colours from CSS variables so the theme switch recolours it). */
  let sid = 0;
  function spark(values, color) {
    const d = (values || []).map(Number).filter(v => isFinite(v));
    if (d.length < 2) return "";
    const W = 200, H = 42, mn = Math.min(...d), mx = Math.max(...d), id = "sp" + (++sid);
    const p = d.map((v, i) => [i * W / (d.length - 1), H - 4 - ((v - mn) / ((mx - mn) || 1)) * (H - 10)]);
    const line = p.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.35"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>
      <path d="${line}L${W},${H}L0,${H}Z" fill="url(#${id})"/><path d="${line}" fill="none" style="stroke:${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  /* % change between the last half and the first half of a series (or two numbers). */
  function change(a, b) { if (!b) return null; return (a - b) / Math.abs(b) * 100; }
  function delta(pct, l, invert) {
    if (pct == null || !isFinite(pct)) return "";
    const up = pct >= 0, good = invert ? !up : up;
    return `<span class="delta ${good ? "up" : "down"}">${up ? "+" : "−"}${num(Math.abs(pct), l, Math.abs(pct) < 10 ? 1 : 0)} %</span>`;
  }

  /* KPI card: icon, label, big value, delta + sub line, sparkline. */
  function kpi(o) {
    const tag = o.href ? "a" : "div";
    return `<${tag} class="card kpi ui-rise ${o.hot ? "hot" : ""}" ${o.href ? `href="${esc(o.href)}"` : ""} style="--kc:${o.color || "var(--accent)"}">
      <div class="l"><i>${icon(o.icon || "grid")}</i><span>${esc(o.label)}</span></div>
      <div class="v">${esc(o.value)}${o.unit ? `<small>${esc(o.unit)}</small>` : ""}</div>
      <div class="s">${o.deltaHtml || ""}<span>${esc(o.sub || "")}</span></div>
      ${spark(o.series, o.color || "var(--accent)")}</${tag}>`;
  }

  /* Cocoa purchases per week: bars = kg, line = average price. */
  function cocoaChart(weeks, l, labelFn) {
    weeks = (weeks || []).filter(w => w.kg > 0);
    if (!weeks.length) return `<p class="muted">${l === "en" ? "No reception recorded yet." : "Aucune réception enregistrée."}</p>`;
    const W = 640, H = 250, L = 46, R = 50, T = 14, B = 28, iw = W - L - R, ih = H - T - B, bw = iw / weeks.length;
    const maxK = Math.max(...weeks.map(w => w.kg)) * 1.1, ps = weeks.map(w => w.avg);
    let pMin = Math.min(...ps), pMax = Math.max(...ps); const pad = Math.max(40, (pMax - pMin) * .15); pMin -= pad; pMax += pad;
    const ky = v => T + ih - v / maxK * ih, py = v => T + ih - (v - pMin) / (pMax - pMin) * ih;
    let g = "";
    for (let k = 0; k <= 4; k++) { const y = T + ih - k * ih / 4;
      g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 8}" y="${y + 4}" text-anchor="end">${num(maxK * k / 4 / 1000, l, maxK < 8000 ? 1 : 0)} t</text><text class="ax" x="${W - R + 8}" y="${y + 4}">${num(pMin + k * (pMax - pMin) / 4, l)}</text>`; }
    const every = Math.max(1, Math.ceil(weeks.length / 12));
    weeks.forEach((w, i) => { const x = L + i * bw + bw * .2, bwid = bw * .6, y = ky(w.kg);
      g += `<rect class="cbar ${i === weeks.length - 1 ? "last" : ""}" x="${x}" y="${y}" width="${bwid}" height="${T + ih - y}" rx="${Math.min(6, bwid / 3)}"><title>${esc(labelFn(w.w))} · ${num(w.kg, l)} kg · ${num(w.avg, l)} F/kg</title></rect>`;
      if (i % every === 0 || i === weeks.length - 1) g += `<text class="ax" x="${x + bwid / 2}" y="${H - 8}" text-anchor="middle">${esc(labelFn(w.w, true))}</text>`; });
    const pts = weeks.map((w, i) => [L + i * bw + bw / 2, py(w.avg)]);
    g += `<path class="cline" d="${pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("")}"/>`;
    pts.forEach((p, i) => g += `<circle class="cdot" cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 3}"><title>${esc(labelFn(weeks[i].w))} · ${num(weeks[i].avg, l)} F/kg</title></circle>`);
    return `<div class="ui-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${l === "en" ? "Cocoa bought per week and average price" : "Cacao acheté par semaine et prix moyen"}">${g}</svg></div>
      <div class="legend"><span><i style="background:var(--accent)"></i>${l === "en" ? "kg bought" : "kg achetés"}</span><span><i style="background:var(--gold)"></i>${l === "en" ? "average price (F/kg)" : "prix moyen (F/kg)"}</span></div>`;
  }

  /* Ring gauge: share of a ceiling. */
  function ring(pct, color, sub) {
    const C = 2 * Math.PI * 48, p = Math.max(0, Math.min(100, pct));
    return `<div class="ring"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="48" fill="none" style="stroke:var(--raise)" stroke-width="10"/><circle cx="55" cy="55" r="48" fill="none" style="stroke:${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C * p / 100} ${C}"/></svg><div class="c"><b>${Math.round(pct)}%</b><span>${esc(sub)}</span></div></div>`;
  }
  /* One cash box row with its ring. */
  function cashRow(o) {
    const color = o.pct > 100 ? "var(--bad)" : o.pct > 80 || o.pct < 10 ? "var(--gold)" : "var(--accent)";
    return `<div class="box-ring">${ring(o.pct, color, o.ringSub)}<div><h4>${esc(o.name)}</h4><div class="bal">${esc(o.balance)}</div>
      <div class="io"><span><b>+${esc(o.inflow)}</b>${esc(o.inLabel)}</span><span><b>−${esc(o.outflow)}</b>${esc(o.outLabel)}</span></div></div></div>`;
  }

  /* Attention feed. items: { lv: "bad"|"warn"|"info"|"ok", m, sub, href } */
  function feed(items, emptyText) {
    if (!items.length) return `<div class="feed"><ul><li><span class="fi ok">${icon("tick", 2.4)}</span><div>${esc(emptyText)}</div></li></ul></div>`;
    return `<div class="feed"><ul>${items.map(a => `<li><span class="fi ${a.lv}">${icon(a.lv === "info" || a.lv === "ok" ? "info" : "alert", 2.2)}</span><div>${a.href ? `<a href="${esc(a.href)}">${esc(a.m)}</a>` : esc(a.m)}${a.sub ? `<small>${esc(a.sub)}</small>` : ""}</div></li>`).join("")}</ul></div>`;
  }

  /* Compact request row (overview lists). o: { open, openAttr, initials, ent, title, tags:[{cls,text}], who, amount, due } */
  const initials = n => String(n || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  function reqRow(o) {
    return `<div class="ap" ${o.openAttr || ""} tabindex="0" role="button"><span class="av ${o.ent === "WHP" ? "whp" : "saic"}">${esc(initials(o.who))}</span>
      <div class="ap-m"><b>${esc(o.title)}</b><div class="meta">${(o.tags || []).map(x => `<span class="tag2 ${x.cls}">${esc(x.text)}</span>`).join("")}<span>${esc(o.who)}</span></div></div>
      <div class="ap-a"><b>${esc(o.amount || "—")}</b><div class="muted small">${esc(o.due || "")}</div></div></div>`;
  }

  /* Sidebar icons: added to the existing nav links by keyword. */
  const NAV = { overview: "grid", approvals: "check", inbox: "inbox", pdg: "send", mine: "send", recep: "pod", treasury: "cash", trace: "pin", team: "users", apps: "apps",
    expenses: "receipt", cacao: "pod", admin: "cash", requests: "send", receptions: "list", zones: "map", farmers: "farmer", stock: "box", map: "map" };
  function decorateNav() {
    document.querySelectorAll(".nav a:not([data-ic])").forEach(a => {
      const k = NAV[(a.getAttribute("href") || "").replace(/^.*#/, "").split(/[-/]/)[0]] || "grid";
      a.dataset.ic = k; a.insertAdjacentHTML("afterbegin", `<span class="nav-ic">${icon(k)}</span>`);
    });
  }
  function start() {
    decorateNav();
    let p = false;
    new MutationObserver(() => { if (p) return; p = true; requestAnimationFrame(() => { p = false; decorateNav(); }); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  /* Week label helpers: "S47" / "W47". */
  function isoWeek(iso) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 864e5 - 3 + (y.getDay() + 6) % 7) / 7); }
  const weekLabel = l => (w, short) => short ? (l === "en" ? "W" : "S") + isoWeek(w) : (l === "en" ? "Week " : "Semaine ") + isoWeek(w);

  window.UI = { esc, num, icon, greet, today, hero, spark, change, delta, kpi, cocoaChart, ring, cashRow, feed, reqRow, initials, weekLabel };
})();
