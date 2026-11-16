// Offline support: keeps the app itself available without a connection.
// Data requests to Supabase always go to the network (the app shows the last loaded registry when offline).
const VERSION = "saic-v5";
const SHELL = ["./", "index.html", "manifest.webmanifest", "js/app.js", "js/api.js", "js/i18n.js", "js/config.js", "js/demo-data.js", "js/logo.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
const CDN = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm", "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(async c => { await c.addAll(SHELL); for (const u of CDN) { try { await c.add(u); } catch (x) {} } }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;
  // own files: network first so updates arrive at once, cache as fallback
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
    return;
  }
  // libraries and fonts: cache first
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; })));
});
