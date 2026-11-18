// ABI — Agricultural Business Intelligence: the SAIC Suite assistant panel.
// Self-contained: add  <script type="module" src="/js/abi.js"></script>  to a page and it mounts
// a floating button and a side panel. It talks to the Supabase Edge Function "abi"
// (supabase/functions/abi) with the signed-in user's session, so ABI only sees what that user sees.
// Stage 2 actions (approve, reject, correct) come back as cards; they are saved here, with the
// user's own session, only when the user clicks Confirm. The database rules still apply.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const FN_URL = SUPABASE_URL ? SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/abi" : "";
const STORE = "abi-chat-v1";

const STR = {
  fr: {
    ask: "Demander à ABI", ask_s: "Résumés, questions, notes", sub: "Agricultural Business Intelligence",
    hello: "Bonjour, je suis ABI. Je peux résumer la trésorerie, les réceptions et le registre, répondre à vos questions et rédiger des notes. Je vois seulement ce que votre rôle permet de voir.",
    ph: "Posez votre question…", send: "Envoyer", new: "Nouvelle conversation", close: "Fermer",
    scope: "Voit seulement ce que votre rôle voit.", ro: "Lecture", act: "Actions avec votre accord",
    foot: "ABI peut se tromper : vérifiez les chiffres importants dans les tableaux de bord.",
    s: ["Résumé de la semaine", "État des caisses", "Réceptions par zone ce mois-ci", "Qu'est-ce qui attend ma validation ?", "Rédige une note de synthèse pour le PDG"],
    copy: "Copier", copied: "Copié ✓", thinking: "ABI réfléchit…",
    signin: "Connectez-vous à SAIC Suite pour utiliser ABI.",
    not_conf: "ABI n'est pas encore activé sur ce serveur (clé API à ajouter). Voir le README, section ABI.",
    not_dep: "ABI n'est pas encore installé sur Supabase. Voir le README, section ABI.",
    no_credit: "Le compte Claude n'a plus de crédit. Ajoutez du crédit sur platform.claude.com (Billing).",
    busy: "ABI est très sollicité. Réessayez dans un instant.", failed: "ABI n'a pas pu répondre. Réessayez.",
    reset: "La conversation a été réinitialisée. Reposez votre question.", offline: "Connexion impossible. Vérifiez internet et réessayez.",
    confirm: "Confirmer", cancel: "Annuler", cancelled: "Annulé. Rien n'a été modifié.",
    done: "Enregistré. Actualisez la page pour voir le changement.", reload: "Actualiser",
    p_fund: "Demande de fonds", p_dg: "Demande à la DG", p_pdg: "Demande au PDG", p_rec: "Correction de réception",
    approve: "Valider", reject: "Refuser", approved: "Valider", rejected: "Refuser", info: "Demander des informations",
    step: "Étape", reason: "Motif", note: "Commentaire", amount: "Montant", from: "De",
    qty: "Quantité achetée", price: "Prix", received: "Quantité reçue",
    check: "Vérifiez puis confirmez. La base de données applique les mêmes règles que l'écran.",
    note_done: (w) => `[Note : j'ai confirmé ${w}.]`, note_cancel: (w) => `[Note : j'ai annulé ${w}.]`,
  },
  en: {
    ask: "Ask ABI", ask_s: "Summaries, questions, notes", sub: "Agricultural Business Intelligence",
    hello: "Hello, I'm ABI. I can summarise the treasury, receptions and registry, answer your questions and draft notes. I only see what your role can see.",
    ph: "Ask a question…", send: "Send", new: "New conversation", close: "Close",
    scope: "Sees only what your role can see.", ro: "Read", act: "Actions with your OK",
    foot: "ABI can make mistakes: check important figures in the dashboards.",
    s: ["This week's summary", "Cash box status", "Receptions by zone this month", "What is waiting for my approval?", "Draft a summary note for the PDG"],
    copy: "Copy", copied: "Copied ✓", thinking: "ABI is thinking…",
    signin: "Sign in to SAIC Suite to use ABI.",
    not_conf: "ABI is not switched on on this server yet (API key to add). See the README, ABI section.",
    not_dep: "ABI is not installed on Supabase yet. See the README, ABI section.",
    no_credit: "The Claude account is out of credit. Add credit at platform.claude.com (Billing).",
    busy: "ABI is busy. Try again in a moment.", failed: "ABI could not answer. Try again.",
    reset: "The conversation was reset. Please ask again.", offline: "Could not connect. Check the internet connection and try again.",
    confirm: "Confirm", cancel: "Cancel", cancelled: "Cancelled. Nothing was changed.",
    done: "Saved. Refresh the page to see the change.", reload: "Refresh",
    p_fund: "Fund request", p_dg: "Request to the DG", p_pdg: "Request to the PDG", p_rec: "Reception correction",
    approve: "Approve", reject: "Reject", approved: "Approve", rejected: "Reject", info: "Ask for information",
    step: "Step", reason: "Reason", note: "Comment", amount: "Amount", from: "From",
    qty: "Quantity bought", price: "Price", received: "Quantity received",
    check: "Check, then confirm. The database applies the same rules as the screen.",
    note_done: (w) => `[Note: I confirmed ${w}.]`, note_cancel: (w) => `[Note: I cancelled ${w}.]`,
  },
};

const CSS = `
/* Colours come from the shared SAIC Suite theme (css/theme.css), so ABI follows dark/light and the WHP brand. */
#abi-root{--a-bg2:var(--paper,#f4f1ea);--a-panel:var(--surface,#fffdf8);--a-hi:var(--raise,#f3efe6);--a-line:var(--line,rgba(40,30,15,.11));--a-line-hi:var(--line-hi,rgba(40,30,15,.22));
  --a-ink:var(--ink,#1c1a14);--a-ink2:var(--ink-2,#4a4538);--a-muted:var(--muted,#736c5d);--a-leaf:var(--accent,#1f8a3a);--a-leaf-soft:var(--accent-soft,rgba(31,138,58,.10));--a-on-leaf:var(--accent-ink,#fff);
  --a-gold:var(--gold,#e59a2f);--a-gold-2:var(--gold-2,#cc7a12);--a-gold-soft:var(--gold-soft,rgba(184,110,10,.11));--a-bad:var(--bad,#c93030);--a-bad-soft:var(--bad-bg,rgba(201,48,48,.10));--a-shadow:var(--shadow,0 14px 32px -20px rgba(60,40,10,.35));
  font:14px/1.5 "Inter","Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--a-ink)}
#abi-root *{box-sizing:border-box} #abi-root [hidden]{display:none!important}
#abi-root button,#abi-root textarea{font:inherit;color:inherit}
#abi-root :focus-visible{outline:2px solid var(--a-gold);outline-offset:2px}
.abi-orb{width:36px;height:36px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe2a8,#f0a944 55%,#4cc35a 120%);display:grid;place-items:center;color:#1a1206;font:800 12px/1 "Bricolage Grotesque",system-ui,sans-serif;flex:none;box-shadow:0 0 18px -2px rgba(240,169,68,.6)}
.abi-fab{position:fixed;right:22px;bottom:22px;z-index:9000;display:flex;align-items:center;gap:10px;background:var(--a-panel);color:var(--a-ink);border:1px solid color-mix(in srgb,var(--a-gold) 45%,transparent);border-radius:999px;padding:7px 18px 7px 7px;cursor:pointer;box-shadow:0 14px 40px -14px var(--a-gold);font-weight:600;text-align:left}
.abi-fab small{display:block;font-weight:400;color:var(--a-muted);font-size:11px}
.abi-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:9001;background:var(--a-bg2);border-left:1px solid var(--a-line-hi);box-shadow:-24px 0 60px -30px rgba(0,0,0,.55);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s ease;visibility:hidden}
.abi-panel.open{transform:none;visibility:visible}
.abi-head{padding:14px 16px;border-bottom:1px solid var(--a-line);display:flex;gap:12px;align-items:center;background:radial-gradient(400px 120px at 0% 0%,var(--a-gold-soft),transparent),radial-gradient(400px 140px at 100% 0%,var(--a-leaf-soft),transparent)}
.abi-head .abi-orb{width:40px;height:40px}
.abi-tt{flex:1;min-width:0} .abi-tt b{font:700 18px/1.1 "Bricolage Grotesque",system-ui,sans-serif;display:block} .abi-tt span{font-size:12px;color:var(--a-muted)}
.abi-ib{background:var(--a-hi);border:1px solid var(--a-line);border-radius:10px;width:34px;height:34px;cursor:pointer;font-size:16px;display:grid;place-items:center}
.abi-scope{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 16px;border-bottom:1px solid var(--a-line);font-size:12px;color:var(--a-muted)}
.abi-chip{white-space:nowrap;border-radius:999px;padding:1px 9px;font-weight:600;font-size:12px;border:1px solid var(--a-line);background:var(--a-gold-soft);color:var(--a-gold)}
.abi-msgs{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.abi-m{max-width:94%;font-size:14px;overflow-wrap:anywhere}
.abi-m.me{align-self:flex-end;background:linear-gradient(135deg,var(--a-gold),var(--a-gold-2));color:#1a1206;font-weight:500;padding:9px 13px;border-radius:16px 16px 4px 16px;white-space:pre-wrap}
.abi-m.bot{align-self:flex-start;background:var(--a-panel);border:1px solid var(--a-line);padding:12px 14px;border-radius:16px 16px 16px 4px;display:flex;flex-direction:column;gap:8px;color:var(--a-ink2)}
.abi-m.bot b,.abi-m.bot strong,.abi-m.bot h4{color:var(--a-ink)} .abi-m.bot h4{margin:2px 0 0;font-size:14px}
.abi-m.bot p{margin:0} .abi-m.bot ul,.abi-m.bot ol{margin:0;padding-left:18px} .abi-m.bot li{margin:2px 0}
.abi-m.bot table{border-collapse:collapse;font-size:12.5px;width:100%} .abi-m.bot th,.abi-m.bot td{border-bottom:1px solid var(--a-line);padding:4px 6px;text-align:left} .abi-m.bot th{color:var(--a-muted);font-weight:600}
.abi-m.bot td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.abi-m.bot code{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:.9em}
.abi-m.err{align-self:flex-start;background:var(--a-bad-soft);color:var(--a-bad);border-radius:12px;padding:9px 12px}
.abi-tools{display:flex;gap:6px}
.abi-tools button{border:1px solid var(--a-line);background:none;border-radius:8px;padding:2px 8px;font-size:12px;cursor:pointer;color:var(--a-muted)}
.abi-typing{display:inline-flex;gap:4px;padding:4px 0;align-items:center} .abi-typing i{width:6px;height:6px;border-radius:50%;background:var(--a-gold);animation:abi-b 1s infinite} .abi-typing i:nth-child(2){animation-delay:.15s} .abi-typing i:nth-child(3){animation-delay:.3s}
.abi-typing span{margin-left:6px;font-size:12px;color:var(--a-muted)}
@keyframes abi-b{0%,60%,100%{opacity:.25}30%{opacity:1}}
.abi-card{background:var(--a-panel);border:1px solid color-mix(in srgb,var(--a-gold) 45%,transparent);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:7px;color:var(--a-ink);align-self:stretch}
.abi-card h5{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--a-gold)}
.abi-row{display:flex;justify-content:space-between;gap:10px;font-size:13px} .abi-row span:first-child{color:var(--a-muted)} .abi-row span:last-child{text-align:right}
.abi-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.abi-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--a-line-hi);background:var(--a-hi);padding:7px 13px;border-radius:10px;cursor:pointer;font-weight:600;font-size:13px}
.abi-btn.ok{background:var(--a-leaf);border-color:transparent;color:var(--a-on-leaf)} .abi-btn.bad{background:var(--a-bad);border-color:transparent;color:#fff}
.abi-btn[disabled]{opacity:.45;cursor:default}
.abi-done{background:var(--a-leaf-soft);color:var(--a-leaf);border-radius:10px;padding:8px 10px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center;justify-content:space-between}
.abi-fail{background:var(--a-bad-soft);color:var(--a-bad);border-radius:10px;padding:8px 10px;font-size:13px}
.abi-muted{color:var(--a-muted);font-size:12px}
.abi-sugg{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 0;border-top:1px solid var(--a-line)}
.abi-sugg button{border:1px solid var(--a-line-hi);background:var(--a-panel);border-radius:999px;padding:5px 11px;font-size:12.5px;cursor:pointer;color:var(--a-ink2);font-weight:500}
.abi-sugg button:hover{border-color:var(--a-leaf);color:var(--a-ink)}
.abi-ask{display:flex;gap:8px;padding:12px 16px 8px;align-items:flex-end}
.abi-ask textarea{flex:1;resize:none;border:1px solid var(--a-line-hi);border-radius:12px;padding:9px 12px;background:var(--a-panel);max-height:140px;min-height:42px}
.abi-ask button{background:linear-gradient(135deg,var(--a-gold),var(--a-gold-2));color:#1a1206;border:0;border-radius:12px;padding:0 16px;height:42px;cursor:pointer;font-weight:700}
.abi-ask button[disabled]{opacity:.5;cursor:default}
.abi-foot{font-size:11px;color:var(--a-muted);padding:0 16px 12px}
body:has(.theme-switch.float) .abi-fab{bottom:70px}
@media (max-width:600px){.abi-fab>span:last-child{display:none}.abi-fab{padding:7px}}
@media print{#abi-root{display:none}}
`;

/* ------------------------------------------------------------------ */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => (document.documentElement.lang || "fr").slice(0, 2) === "en" ? "en" : "fr";
const t = k => STR[lang()][k];
const fmt = n => Number(n || 0).toLocaleString(lang() === "fr" ? "fr-FR" : "en-GB");

// Small, safe Markdown: escape first, then bold/italic/code, headings, lists, tables, paragraphs.
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushP(); flushL();
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      const isNum = c => /^[-+]?[\d\s.,  ]+(%|F|kg|ha)?$/.test(c) && /\d/.test(c);
      out.push(`<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td class="${isNum(c) ? "n" : ""}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    let m;
    if ((m = l.match(/^\s*#{1,4}\s+(.*)$/))) { flushP(); flushL(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.tag !== "ul") { flushL(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.tag !== "ol") { flushL(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
    if (!l.trim()) { flushP(); flushL(); continue; }
    flushL(); para.push(l);
  }
  flushP(); flushL();
  return out.join("");
}

/* ------------------------------------------------------------------ */
let sb = null;
async function client() {
  if (sb) return sb;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return sb;
}

// Chat state, kept for this browser tab so it follows the user from page to page.
let S = { view: [], conversation: [], notes: [] };
try { const x = JSON.parse(globalThis.sessionStorage?.getItem(STORE)); if (x && Array.isArray(x.view)) S = { notes: [], ...x }; } catch (e) {}
function save() {
  try { sessionStorage.setItem(STORE, JSON.stringify(S)); }
  catch (e) { try { S.conversation = S.conversation.slice(-12); sessionStorage.setItem(STORE, JSON.stringify(S)); } catch (x) {} }
}

let root, msgs, input, sendBtn, busy = false;

function mount() {
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement("div"); root.id = "abi-root";
  root.innerHTML = `
  <button class="abi-fab" type="button" aria-haspopup="dialog"><span class="abi-orb">ABI</span><span><span data-s="ask"></span><small data-s="ask_s"></small></span></button>
  <aside class="abi-panel" role="dialog" aria-label="ABI" aria-modal="false">
    <div class="abi-head"><span class="abi-orb">ABI</span><div class="abi-tt"><b>ABI</b><span data-s="sub"></span></div>
      <button class="abi-ib" type="button" data-a="new">↺</button><button class="abi-ib" type="button" data-a="close">×</button></div>
    <div class="abi-scope"><span class="abi-chip" data-s="act"></span><span data-s="scope"></span></div>
    <div class="abi-msgs" aria-live="polite"></div>
    <div class="abi-sugg"></div>
    <form class="abi-ask"><textarea rows="1"></textarea><button type="submit" data-s="send"></button></form>
    <div class="abi-foot" data-s="foot"></div>
  </aside>`;
  document.body.appendChild(root);
  msgs = root.querySelector(".abi-msgs"); input = root.querySelector("textarea"); sendBtn = root.querySelector(".abi-ask button");
  root.querySelector(".abi-fab").onclick = open;
  root.querySelector("[data-a=close]").onclick = close;
  root.querySelector("[data-a=new]").onclick = () => { S = { view: [], conversation: [], notes: [] }; save(); render(); input.focus(); };
  root.querySelector(".abi-ask").onsubmit = e => { e.preventDefault(); send(input.value); };
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && root.querySelector(".abi-panel.open")) close(); });
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  render();
  if (sessionStorage.getItem(STORE + "-open") === "1") open();
}
function open() { root.querySelector(".abi-panel").classList.add("open"); root.querySelector(".abi-fab").hidden = true; try { sessionStorage.setItem(STORE + "-open", "1"); } catch (e) {} setTimeout(() => input.focus(), 220); }
function close() { root.querySelector(".abi-panel").classList.remove("open"); root.querySelector(".abi-fab").hidden = false; try { sessionStorage.setItem(STORE + "-open", "0"); } catch (e) {} root.querySelector(".abi-fab").focus(); }

function render() {
  root.querySelectorAll("[data-s]").forEach(e => { e.textContent = t(e.dataset.s); });
  root.querySelector("[data-a=new]").title = t("new"); root.querySelector("[data-a=close]").title = t("close");
  input.placeholder = t("ph");
  const sg = root.querySelector(".abi-sugg");
  sg.innerHTML = t("s").map(s => `<button type="button">${esc(s)}</button>`).join("");
  sg.querySelectorAll("button").forEach(b => b.onclick = () => send(b.textContent));
  sg.hidden = S.view.some(v => v.who === "me");
  msgs.innerHTML = `<div class="abi-m bot"><p>${esc(t("hello"))}</p></div>` + S.view.map(viewHtml).join("");
  wire(); msgs.scrollTop = 1e9;
}
function viewHtml(v, i) {
  if (v.who === "me") return `<div class="abi-m me">${esc(v.text)}</div>`;
  if (v.who === "err") return `<div class="abi-m err">${esc(v.text)}</div>`;
  return `<div class="abi-m bot" data-i="${i}">${md(v.text)}${(v.proposals || []).map((p, j) => cardHtml(p, i, j)).join("")}
    ${v.text ? `<div class="abi-tools"><button type="button" data-copy="${i}">${esc(t("copy"))}</button></div>` : ""}</div>`;
}
function cardHtml(p, i, j) {
  const row = (a, b) => `<div class="abi-row"><span>${esc(a)}</span><span>${b}</span></div>`;
  let h = "", label = "", danger = false;
  if (p.kind === "fund_request") {
    label = p.decision === "approve" ? t("approve") : t("reject"); danger = p.decision !== "approve";
    h = `<h5>${esc(t("p_fund"))} · ${esc(p.id)}</h5>` + row(p.title || "", `<b>${fmt(p.amount)} F</b>`) +
      row(t("step"), esc(`${p.current} → ${p.next_status}`)) + (p.reason ? row(t("reason"), esc(p.reason)) : "");
  } else if (p.kind === "dg_requests" || p.kind === "pdg_requests") {
    label = t(p.decision); danger = p.decision === "rejected";
    h = `<h5>${esc(t(p.kind === "dg_requests" ? "p_dg" : "p_pdg"))} · ${esc(p.id)}</h5>` + row(p.title || "", p.amount ? `<b>${fmt(p.amount)} F</b>` : "") +
      (p.from ? row(t("from"), esc(p.from)) : "") + (p.note ? row(t("note"), esc(p.note)) : "");
  } else if (p.kind === "reception") {
    label = t("confirm");
    h = `<h5>${esc(t("p_rec"))} · n° ${esc(p.no)} · ${esc(p.date)} · ${esc(p.zone)}</h5>` +
      Object.entries(p.change).map(([k, [a, b]]) => row(t(k), `<s>${a == null ? "—" : fmt(a)}</s> → <b>${fmt(b)}</b>`)).join("") + row(t("reason"), esc(p.reason));
  } else return "";
  const st = p.state;
  return `<div class="abi-card">${h}
    ${!st ? `<div class="abi-btns"><button type="button" class="abi-btn ${danger ? "bad" : "ok"}" data-go="${i}:${j}">${esc(label)}</button><button type="button" class="abi-btn" data-no="${i}:${j}">${esc(t("cancel"))}</button></div><div class="abi-muted">${esc(t("check"))}</div>` : ""}
    ${st === "done" ? `<div class="abi-done"><span>✓ ${esc(t("done"))}</span><button type="button" class="abi-btn" data-reload>${esc(t("reload"))}</button></div>` : ""}
    ${st === "cancelled" ? `<div class="abi-muted">${esc(t("cancelled"))}</div>` : ""}
    ${st && st.startsWith("error:") ? `<div class="abi-fail">${esc(st.slice(6))}</div><div class="abi-btns"><button type="button" class="abi-btn" data-go="${i}:${j}">${esc(label)}</button></div>` : ""}
  </div>`;
}
function wire() {
  msgs.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(S.view[+b.dataset.copy].text); b.textContent = t("copied"); } catch (e) {}
  });
  msgs.querySelectorAll("[data-go]").forEach(b => b.onclick = () => execute(...b.dataset.go.split(":").map(Number), b));
  msgs.querySelectorAll("[data-no]").forEach(b => b.onclick = () => {
    const [i, j] = b.dataset.no.split(":").map(Number), p = S.view[i].proposals[j];
    p.state = "cancelled"; S.notes.push(t("note_cancel")(`${p.kind} ${p.id}`)); save(); render();
  });
  msgs.querySelectorAll("[data-reload]").forEach(b => b.onclick = () => location.reload());
}

/* ---------- stage 2: the user confirmed, save with their own session ---------- */
async function execute(i, j, btn) {
  const p = S.view[i].proposals[j];
  btn.disabled = true;
  try {
    const db = await client();
    let r;
    if (p.kind === "fund_request") {
      r = await db.from("fund_requests").update(p.decision === "approve" ? { status: p.next_status } : { status: "rejected", reject_reason: p.reason }).eq("id", p.id).select("id");
    } else if (p.kind === "dg_requests" || p.kind === "pdg_requests") {
      r = await db.from(p.kind).update({ status: p.decision, last_note: p.note || null }).eq("id", p.id).select("id");
    } else if (p.kind === "reception") {
      const patch = Object.fromEntries(Object.entries(p.change).map(([k, [, b]]) => [k, b]));
      const stamp = new Date().toISOString().slice(0, 10);
      patch.obs = [p.obs, `ABI ${stamp}: ${p.reason}`].filter(Boolean).join(" | ");
      r = await db.from("cocoa_receptions").update(patch).eq("id", p.id).select("id");
    }
    if (r.error) throw new Error(r.error.message);
    if (!r.data || !r.data.length) throw new Error(lang() === "fr" ? "Rien n'a été modifié : vos droits ne le permettent pas." : "Nothing was changed: your access does not allow it.");
    p.state = "done"; S.notes.push(t("note_done")(`${p.kind} ${p.id} (${p.decision || "correction"})`));
  } catch (e) { p.state = "error:" + (e.message || String(e)); }
  save(); render();
}

/* ---------- ask ABI ---------- */
async function send(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  if (!FN_URL) return;
  busy = true; sendBtn.disabled = true; input.value = ""; input.style.height = "auto";
  S.view.push({ who: "me", text }); save(); render();
  const wait = document.createElement("div"); wait.className = "abi-m bot";
  wait.innerHTML = `<span class="abi-typing"><i></i><i></i><i></i><span>${esc(t("thinking"))}</span></span>`;
  msgs.appendChild(wait); msgs.scrollTop = 1e9;
  try {
    if (!navigator.onLine) throw new Error(t("offline"));
    const db = await client();
    const { data: { session } } = await db.auth.getSession();
    if (!session) throw new Error(t("signin"));
    const message = (S.notes.length ? S.notes.join("\n") + "\n\n" : "") + text;
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ message, lang: lang(), page: document.title, conversation: S.conversation }),
    });
    let out = {}; try { out = await res.json(); } catch (e) {}
    if (!res.ok) {
      const code = out.error || (res.status === 404 ? "not_dep" : res.status === 401 ? "sign_in" : "failed");
      if (code === "reset") S.conversation = [];
      throw new Error(t({ sign_in: "signin", not_configured: "not_conf", not_dep: "not_dep", busy: "busy", reset: "reset", no_credit: "no_credit" }[code] || "failed"));
    }
    S.notes = [];
    S.conversation = Array.isArray(out.conversation) ? out.conversation : [];
    S.view.push({ who: "bot", text: out.reply || "", proposals: out.proposals || [] });
  } catch (e) {
    const m = e && e.message || "";
    S.view.push({ who: "err", text: !m || /fetch|network|load failed/i.test(m) ? t("offline") : m });
  }
  busy = false; sendBtn.disabled = false; save(); render(); input.focus();
}

export { md };

if (FN_URL && typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
}
