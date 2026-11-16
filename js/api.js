// Data layer: Supabase when configured, otherwise a demo store in this browser.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { DEMO_FARMERS } from "./demo-data.js";

const snake = k => k.replace(/[A-Z]/g, m => "_" + m.toLowerCase());
const camel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const SKIP = new Set(["plots", "id_", "createdAt", "createdBy", "updatedAt", "updatedBy"]);
function toDb(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    if (SKIP.has(k)) continue;
    r[snake(k)] = v === "" || v === undefined ? null : v;
  }
  return r;
}
function fromDb(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (k === "plots") continue;
    r[camel(k)] = v === null ? "" : v;
  }
  if (r.polygon === "") r.polygon = null;
  return r;
}
const farmerFromDb = row => {
  const f = fromDb(row);
  f.plots = (row.plots || []).map(fromDb).map(p => ({ ...p, area: p.area === "" ? "" : String(p.area), expectedKg: p.expectedKg === "" ? "" : String(p.expectedKg) })).sort((a, b) => a.pid.localeCompare(b.pid));
  return f;
};
const errMsg = e => (e && (e.message || e.error_description)) || String(e);

/* ------------------------------------------------------------------ */
async function supabaseBackend() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const urlCache = new Map();
  const must = ({ data, error }) => { if (error) throw new Error(errMsg(error)); return data; };
  return {
    mode: "live",
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    onRecovery(cb) { sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") cb(); }); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async setPassword(password) { must(await sb.auth.updateUser({ password })); },
    async me() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      const p = must(await sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
      return { id: user.id, email: user.email, name: p?.full_name || user.email, role: p?.role || "viewer" };
    },
    async listFarmers() {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = must(await sb.from("farmers").select("*, plots(*)").order("id").range(from, from + 999));
        out.push(...rows.map(farmerFromDb));
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getFarmer(id) { return farmerFromDb(must(await sb.from("farmers").select("*, plots(*)").eq("id", id).single())); },
    async createFarmer(data) { const row = must(await sb.from("farmers").insert(toDb(data)).select("id").single()); return this.getFarmer(row.id); },
    async updateFarmer(id, patch) { must(await sb.from("farmers").update(toDb(patch)).eq("id", id)); return this.getFarmer(id); },
    async savePlot(farmerId, plot) {
      const body = toDb(plot); delete body.id;
      if (plot.id) must(await sb.from("plots").update(body).eq("id", plot.id));
      else must(await sb.from("plots").insert({ ...body, farmer_id: farmerId }));
      return this.getFarmer(farmerId);
    },
    async history(farmerId) {
      const rows = must(await sb.from("change_log").select("*").eq("farmer_id", farmerId).order("changed_at", { ascending: false }).limit(100));
      return rows.map(logFromDb);
    },
    async recent(n = 8) { return must(await sb.from("change_log").select("*").order("changed_at", { ascending: false }).limit(n)).map(logFromDb); },
    async profiles() { return must(await sb.from("profiles").select("*").order("full_name")); },
    async setRole(id, role) { must(await sb.from("profiles").update({ role }).eq("id", id)); },
    async uploadPhoto(farmerId, blob) {
      const path = `${farmerId}/${Date.now()}.jpg`;
      must(await sb.storage.from("farmer-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
      return path;
    },
    async photoUrls(paths) {
      const need = paths.filter(p => p && !urlCache.has(p));
      if (need.length) {
        const { data } = await sb.storage.from("farmer-photos").createSignedUrls(need, 6 * 3600);
        for (const d of data || []) if (d.signedUrl) urlCache.set(d.path, d.signedUrl);
      }
      const r = {}; for (const p of paths) if (urlCache.has(p)) r[p] = urlCache.get(p); return r;
    }
  };
}
function logFromDb(r) {
  const ch = r.changes ? Object.entries(r.changes).map(([k, [a, b]]) => [camel(k), a, b]) : [];
  return { at: r.changed_at, by: r.changed_by, farmerId: r.farmer_id, table: r.table_name, label: r.record_label, action: r.action, ch };
}

/* ------------------------------------------------------------------ */
function demoBackend() {
  const KEY = "saic-demo-v1";
  let db;
  const load = () => { try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; } if (!db) reset(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw new Error("The browser storage is full. Use smaller photos."); } };
  const reset = () => { db = { farmers: JSON.parse(JSON.stringify(DEMO_FARMERS)), log: DEMO_FARMERS.map(f => ({ at: f.createdAt, by: "demo", farmerId: f.id, table: "farmers", label: f.id, action: "created", ch: [] })), seq: 0 }; save(); };
  const me = { id: "demo", email: "demo@saic.local", name: "Demo user", role: "lead" };
  const clone = o => JSON.parse(JSON.stringify(o));
  const log = (f, table, label, action, before, after) => {
    let ch = [];
    if (before) for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (["plots", "updatedAt", "updatedBy"].includes(k)) continue;
      const a = before[k] ?? "", b = after[k] ?? "";
      if (JSON.stringify(a) !== JSON.stringify(b)) ch.push([k, a === "" ? null : a, b === "" ? null : b]);
    }
    if (action === "updated" && !ch.length) return;
    db.log.unshift({ at: new Date().toISOString(), by: "demo", farmerId: f, table, label, action, ch });
  };
  load();
  return {
    mode: "demo",
    reset() { reset(); },
    async session() { return { demo: true }; },
    onRecovery() {},
    async signIn() {}, async signOut() {}, async resetPassword() {}, async setPassword() {},
    async me() { return me; },
    async listFarmers() { return clone(db.farmers); },
    async getFarmer(id) { return clone(db.farmers.find(f => f.id === id)); },
    async createFarmer(data) {
      const n = Math.max(db.seq, ...db.farmers.filter(f => /^F\d+$/.test(f.id)).map(f => +f.id.slice(1)), 0) + 1;
      db.seq = n;
      const f = { ...data, id: "F" + String(n).padStart(4, "0"), plots: [], createdAt: new Date().toISOString() };
      db.farmers.push(f); log(f.id, "farmers", f.id, "created"); save(); return clone(f);
    },
    async updateFarmer(id, patch) {
      const f = db.farmers.find(x => x.id === id); const before = clone(f);
      Object.assign(f, patch); log(id, "farmers", id, "updated", before, f); save(); return clone(f);
    },
    async savePlot(farmerId, plot) {
      const f = db.farmers.find(x => x.id === farmerId);
      if (plot.id) { const i = f.plots.findIndex(p => p.id === plot.id); const before = clone(f.plots[i]); f.plots[i] = { ...f.plots[i], ...plot }; log(farmerId, "plots", farmerId + " " + plot.pid, "updated", before, f.plots[i]); }
      else { if (f.plots.some(p => p.pid === plot.pid)) throw new Error("Plot " + plot.pid + " already exists"); f.plots.push({ ...plot, id: "p" + Math.random().toString(36).slice(2) }); log(farmerId, "plots", farmerId + " " + plot.pid, "created"); }
      save(); return clone(f);
    },
    async history(id) { return clone(db.log.filter(l => l.farmerId === id).slice(0, 100)); },
    async recent(n = 8) { return clone(db.log.slice(0, n)); },
    async profiles() { return [{ id: "demo", full_name: "Demo user", role: "lead" }]; },
    async setRole() {},
    async uploadPhoto(farmerId, blob) { return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); },
    async photoUrls(paths) { const r = {}; for (const p of paths) if (p) r[p] = p; return r; }
  };
}

export async function createApi() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return supabaseBackend();
  return demoBackend();
}
