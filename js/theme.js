/* SAIC Suite theme switch. Load in <head> (plain script, not a module) so the
   right theme is set before the page paints. Choice is kept per browser in
   localStorage "saic-theme"; default is dark. */
(function () {
  var root = document.documentElement;
  var KEY = "saic-theme";
  function saved() { try { var v = localStorage.getItem(KEY); if (v === "dark" || v === "light") return v; } catch (e) {} return "dark"; }
  function setMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = theme === "dark" ? (root.dataset.brand === "whp" ? "#0a0f17" : "#0b110e") : (root.dataset.brand === "whp" ? "#f2f4f8" : "#f4f1ea");
  }
  root.dataset.theme = saved();
  var p = location.pathname;
  if (/^\/(pdg|dg-whp)(\/|$)/.test(p)) root.dataset.brand = "whp";

  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  function label() { var en = (root.lang || "fr").slice(0, 2) === "en"; return root.dataset.theme === "dark" ? (en ? "Switch to light theme" : "Passer au thème clair") : (en ? "Switch to dark theme" : "Passer au thème sombre"); }

  function set(theme) {
    root.classList.add("theme-anim");
    root.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    setMeta(theme);
    document.querySelectorAll(".theme-switch").forEach(function (b) { b.setAttribute("aria-label", label()); b.title = label(); });
    setTimeout(function () { root.classList.remove("theme-anim"); }, 400);
    window.dispatchEvent(new CustomEvent("saic-theme", { detail: theme }));
  }
  window.SAICTheme = { set: set, toggle: function () { set(root.dataset.theme === "dark" ? "light" : "dark"); } };

  function button() {
    var b = document.createElement("button");
    b.type = "button"; b.className = "theme-switch";
    b.innerHTML = '<span class="d">' + MOON + '</span><span class="l">' + SUN + "</span>";
    b.setAttribute("aria-label", label()); b.title = label();
    b.addEventListener("click", window.SAICTheme.toggle);
    return b;
  }
  /* Pages redraw their rail footer / header often; keep one switch in it. */
  function place() {
    var host = document.querySelector(".rail-foot") || document.querySelector(".top .who");
    var visibleHost = host && host.offsetParent !== null ? host : null;
    var cur = document.querySelector(".theme-switch");
    if (visibleHost) {
      if (cur && cur.parentNode === visibleHost) return;
      if (cur) cur.remove();
      var b = button(); visibleHost.appendChild(b);
    } else {
      if (cur && cur.classList.contains("float")) return;
      if (cur) cur.remove();
      var f = button(); f.classList.add("float"); document.body.appendChild(f);
    }
  }
  function start() {
    setMeta(root.dataset.theme);
    place();
    var pending = false;
    new MutationObserver(function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; place(); });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
