// SAIC Farmer Registry — F01 checks and geometry (no DOM, no app state).
// Imported by app.js and by the unit tests in tests/.

/* ---------- rules (tweak here) ---------- */
export const POLYGON_THRESHOLD_HA = 4;   // manual: above 4 ha a perimeter polygon is required
export const MIN_DECIMALS = 6;           // EUDR point precision
export const YIELD_FLAG_KG_HA = 1000;    // expected production above this per ha is flagged
export const AREA_TOLERANCE = 0.2;       // mapped vs declared area difference flagged above 20 %
export const DUP_POINT_M = 10;           // points closer than this are possible duplicates
export const CMR = { latMin: 1.6, latMax: 13.1, lonMin: 8.4, lonMax: 16.3 };

/* ---------- helpers ---------- */
export const isNum = v => v !== "" && v !== null && v !== undefined && isFinite(Number(v));
export const decimals = s => { s = String(s ?? "").trim(); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
export const plotLabel = (f, p) => `${f.id} ${p.pid}`;
export const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const plainFmt = (n, d = 0) => Number(n).toFixed(d);

/* ---------- geometry ---------- */
export function polyAreaHa(poly) {
  if (!poly || poly.length < 3) return 0;
  const lat0 = poly.reduce((a, p) => a + p[1], 0) / poly.length * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540; let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky); }
  return Math.abs(s) / 2 / 10000;
}
export const centroid = poly => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
export function distM(a, b) { const kx = 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540); }
export function bbox(poly) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; }
export function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
export function segX(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
export function polysOverlap(A, B) {
  const a = bbox(A), b = bbox(B); if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) return false;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segX(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return inPoly(A[0], B) || inPoly(B[0], A);
}
export const hasPoly = p => Array.isArray(p.polygon) && p.polygon.length >= 3;
export function plotPoint(p) { if (isNum(p.lat) && isNum(p.lon)) return [Number(p.lon), Number(p.lat)]; if (hasPoly(p)) return centroid(p.polygon); return null; }
export function parseGeometry(text, L = "en") {
  text = String(text || "").trim();
  if (!text) return { polygon: null };
  const finish = (r, note) => {
    r = r.filter(c => isFinite(c[0]) && isFinite(c[1]));
    if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length < 3) return { error: L === "fr" ? "Un polygone doit avoir au moins 3 sommets distincts." : "A polygon needs at least 3 distinct corners." };
    return { polygon: r.map(c => [+(+c[0]).toFixed(7), +(+c[1]).toFixed(7)]), note };
  };
  if (text.startsWith("{") || text.startsWith("[")) {
    let g; try { g = JSON.parse(text); } catch (e) { return { error: "GeoJSON: " + e.message }; }
    const pick = g => {
      if (!g) return null;
      if (g.type === "FeatureCollection") { for (const f of g.features || []) { const r = pick(f); if (r) return r; } return null; }
      if (g.type === "Feature") return pick(g.geometry);
      if (g.type === "Polygon") return { ring: g.coordinates[0] };
      if (g.type === "MultiPolygon") return { ring: g.coordinates[0][0], multi: g.coordinates.length > 1 };
      if (g.type === "Point") return { point: g.coordinates };
      if (Array.isArray(g) && Array.isArray(g[0])) return { ring: Array.isArray(g[0][0]) ? g[0] : g };
      return null;
    };
    const r = pick(g);
    if (!r) return { error: L === "fr" ? "Aucun polygone ni point trouvé dans le GeoJSON." : "No Polygon or Point found in the GeoJSON." };
    if (r.point) return { point: { lat: String(r.point[1]), lon: String(r.point[0]) }, polygon: null };
    return finish(r.ring.map(c => [Number(c[0]), Number(c[1])]), r.multi ? (L === "fr" ? "Seul le premier polygone a été conservé." : "Only the first polygon was kept.") : "");
  }
  if (/<coordinates>/i.test(text)) {
    const m = text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    return finish(m[1].trim().split(/\s+/).map(s => s.split(",").map(Number)).map(c => [c[0], c[1]]));
  }
  const ring = [];
  for (const l of text.split(/\n+/).map(x => x.trim()).filter(Boolean)) {
    const parts = l.split(/[;\s]+|,\s+|,(?=-?\d)/).filter(Boolean).map(Number);
    if (parts.length < 2 || parts.some(x => !isFinite(x))) return { error: (L === "fr" ? "Ligne illisible : " : "Cannot read the line: ") + l };
    ring.push([parts[1], parts[0]]);
  }
  return finish(ring);
}

/* ---------- F01 checks ---------- */
const I = (lv, k, p = {}) => ({ lv, k, p });
export function allGeoms(farmers) { const out = []; for (const f of farmers) { if (f.archived) continue; for (const p of f.plots || []) out.push({ f, p }); } return out; }
export function plotIssues(f, p, geoms, fmt = plainFmt) {
  const out = [], bad = (k, x) => out.push(I("bad", k, x)), warn = (k, x) => out.push(I("warn", k, x));
  const pt = plotPoint(p), poly = hasPoly(p), hasPt = isNum(p.lat) && isNum(p.lon), area = Number(p.area) || 0;
  if (!hasPt && !poly) bad("i.no_geo");
  if (area > POLYGON_THRESHOLD_HA && !poly) bad("i.poly_req", { a: fmt(area, 2), t: POLYGON_THRESHOLD_HA });
  if (!area) warn("i.no_area");
  if (hasPt && !poly && (decimals(p.lat) < MIN_DECIMALS || decimals(p.lon) < MIN_DECIMALS)) bad("i.decimals", { d: MIN_DECIMALS });
  if (pt && /cameroon|cameroun/i.test(p.country || "")) {
    const inC = (lon, lat) => lat >= CMR.latMin && lat <= CMR.latMax && lon >= CMR.lonMin && lon <= CMR.lonMax;
    if (!inC(pt[0], pt[1])) bad(inC(pt[1], pt[0]) ? "i.swapped" : "i.outside");
  }
  if (poly && area) { const m = polyAreaHa(p.polygon); if (Math.abs(m - area) / area > AREA_TOLERANCE) warn("i.area_diff", { m: fmt(m, 2), a: fmt(area, 2) }); }
  for (const g of geoms) {
    if (g.p === p || (g.p.id && g.p.id === p.id)) continue;
    const gp = hasPoly(g.p), lab = plotLabel(g.f, g.p);
    if (poly && gp && polysOverlap(p.polygon, g.p.polygon)) bad("i.overlap", { p: lab });
    else if (poly && !gp && isNum(g.p.lat) && inPoly(plotPoint(g.p), p.polygon)) bad("i.pt_in_poly", { p: lab });
    else if (!poly && hasPt && gp && inPoly(pt, g.p.polygon)) bad("i.in_other", { p: lab });
    else if (!poly && hasPt && !gp && isNum(g.p.lat) && distM(pt, plotPoint(g.p)) < DUP_POINT_M) warn("i.dup_pt", { m: DUP_POINT_M, p: lab });
  }
  if (!p.defoEvidence || !p.defoDate) bad("i.defo");
  if (!p.legalEvidence) warn("i.legal");
  if (!p.rightEvidence) warn("i.right");
  if (!p.linkEvidence) warn("i.link");
  if (!p.mapDate || !p.provider || (poly && !p.fileVersion)) warn("i.mapping");
  if (!p.harvest) warn("i.harvest");
  if (area && Number(p.expectedKg) && Number(p.expectedKg) / area > YIELD_FLAG_KG_HA) warn("i.yield", { y: fmt(Number(p.expectedKg) / area), t: fmt(YIELD_FLAG_KG_HA) });
  if (p.decision === "Hold") bad("i.dec_hold");
  if (p.decision === "Rejected") bad("i.dec_rej");
  return out;
}
export function plotStatus(p, iss) {
  if (iss.some(i => i.lv === "bad")) return "hold";
  if (p.decision === "Approved" && p.chkFormat && p.chkLink && p.chkRisk) return "verified";
  return "pending";
}
export function farmerIssues(f, farmers = []) {
  const out = [], bad = (k, x) => out.push(I("bad", k, x)), warn = (k, x) => out.push(I("warn", k, x));
  if (!f.idType || !f.idNumber) bad("i.no_id"); else if (!f.idViewedOn) warn("i.id_viewed");
  if (!f.photoPath) warn("i.no_photo");
  if (!f.phone) warn("i.no_phone");
  if (!(f.plots || []).length) bad("i.no_plots");
  if (!f.confirmDate) warn("i.no_confirm");
  if (f.type && f.type !== "Farmer" && !f.representative) warn("i.no_rep");
  for (const o of farmers) {
    if (o.id === f.id || o.archived) continue;
    if (f.idNumber && o.idNumber && norm(f.idNumber) === norm(o.idNumber)) bad("i.same_id", { o: o.id });
    else if (norm(f.name) && norm(f.name) === norm(o.name) && norm(f.village) === norm(o.village)) warn("i.dup_name", { o: o.id });
  }
  if (f.decision === "Hold") bad("i.dec_hold");
  if (f.decision === "Rejected") bad("i.dec_rej");
  return out;
}
export function evaluate(f, geoms, farmers = [], fmt = plainFmt) {
  const plots = (f.plots || []).map(p => { const iss = plotIssues(f, p, geoms, fmt); return { p, issues: iss, status: plotStatus(p, iss) }; });
  const issues = farmerIssues(f, farmers);
  let status;
  if (f.archived) status = "archived";
  else if (issues.some(i => i.lv === "bad") || plots.some(x => x.status === "hold")) status = "hold";
  else if (f.decision === "Approved" && f.chkIdentity && f.chkRep && f.chkPlots && plots.length && plots.every(x => x.status === "verified")) status = "verified";
  else status = "pending";
  return { issues, plots, status };
}
