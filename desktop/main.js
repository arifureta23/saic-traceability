// SAIC Suite — desktop app for Windows and macOS.
// It opens the live SAIC apps in their own window, so every update to the site reaches the app at once.
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");

const SITE = "https://saic-traceability.vercel.app";
const START = SITE + "/suite/";
const ALLOWED = new Set([new URL(SITE).origin]);
const isInternal = url => { try { return ALLOWED.has(new URL(url).origin); } catch (e) { return false; } };

let win;
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function offlinePage() {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>SAIC Suite</title>
  <style>body{font:16px/1.5 "Segoe UI",system-ui,sans-serif;background:#f3f5f2;color:#1b2420;display:grid;place-items:center;height:100vh;margin:0}
  .c{background:#fff;border:1px solid #d9dfd9;border-radius:10px;padding:28px 32px;max-width:460px;text-align:center}
  button{margin-top:16px;background:#1f5c47;color:#fff;border:0;border-radius:6px;padding:9px 18px;font:inherit;cursor:pointer}</style></head>
  <body><div class="c"><h2>Pas de connexion internet</h2><p>SAIC Suite a besoin d'internet pour afficher les données à jour. Vérifiez la connexion puis réessayez.</p>
  <p style="color:#5d6a63;font-size:14px">No internet connection. Check the connection and try again.</p>
  <button onclick="location.href='${START}'">Réessayer / Retry</button></div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600,
    title: "SAIC Suite", backgroundColor: "#f3f5f2", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent() + " SAICSuite/" + app.getVersion());
  win.once("ready-to-show", () => { win.maximize(); win.show(); });

  // links inside the SAIC site stay in the app; anything else (files, emails, other sites) opens in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) { win.loadURL(url); return { action: "deny" }; }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInternal(url) && !url.startsWith("data:")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadURL(offlinePage());   // -3 = navigation aborted, not an error
  });

  win.loadURL(START);
}

const isMac = process.platform === "darwin";

function buildMenu() {
  const go = p => () => win && win.loadURL(SITE + p);
  // On macOS, copy/paste shortcuts only work when an Edit menu exists.
  const editMenu = isMac ? [{ label: "Édition / Edit", submenu: [
    { role: "undo", label: "Annuler / Undo" }, { role: "redo", label: "Rétablir / Redo" }, { type: "separator" },
    { role: "cut", label: "Couper / Cut" }, { role: "copy", label: "Copier / Copy" }, { role: "paste", label: "Coller / Paste" },
    { role: "selectAll", label: "Tout sélectionner / Select all" } ] }] : [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "SAIC Suite", submenu: [
      { label: "Accueil / Home", accelerator: isMac ? "Cmd+Shift+H" : "Ctrl+H", click: go("/suite/") },
      { type: "separator" },
      { label: "Registre des producteurs", click: go("/") },
      { label: "Trésorerie", click: go("/tresorerie/") },
      { label: "Réception cacao", click: go("/reception/") },
      { label: "Direction Générale SAIC", click: go("/dg-saic/") },
      { label: "Direction Générale WHP", click: go("/dg-whp/") },
      { label: "Tableau de bord PDG", click: go("/pdg/") },
      { type: "separator" },
      { role: "quit", label: "Quitter / Quit" } ] },
    ...editMenu,
    { label: "Affichage / View", submenu: [
      { label: "Retour / Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: () => win && win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: "Actualiser / Refresh", accelerator: isMac ? "Cmd+R" : "F5", click: () => win && win.webContents.reload() },
      { type: "separator" },
      { role: "zoomIn", label: "Agrandir / Zoom in" }, { role: "zoomOut", label: "Réduire / Zoom out" }, { role: "resetZoom", label: "Taille normale / Actual size" },
      { type: "separator" }, { role: "togglefullscreen", label: "Plein écran / Full screen" } ] },
    { label: "Aide / Help", submenu: [
      { label: "À propos / About", click: () => dialog.showMessageBox(win, { type: "info", title: "SAIC Suite", message: "SAIC Suite " + app.getVersion(),
        detail: "Société Agro Industrielle Camerounaise\nRegistre, Trésorerie, Réception cacao, Direction Générale, PDG.\n" + SITE }) } ] }
  ]));
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on("window-all-closed", () => app.quit());
