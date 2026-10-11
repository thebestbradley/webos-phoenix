// The webOS frame around every screen: theme from ?theme=light|dark, the
// status bar with the app menu tab, the gesture area. ?card=1 renders only
// the app (no status bar or gesture area) for the card view.
(function () {
  const q = new URLSearchParams(location.search);
  const html = document.documentElement;
  html.dataset.theme = q.get("theme") || "dark";
  if (q.get("card")) html.classList.add("as-card");
  if (q.get("wp")) html.style.setProperty("--wp", 'url("../assets/' + q.get("wp") + '.jpg")');

  window.phxFrame = function () {
    const sb = document.querySelector(".statusbar");
    if (sb) {
      const app = sb.dataset.app || "";
      sb.innerHTML =
        (app
          ? '<button class="apptab">' + app + PHX_ICON("chevD", "tab-chev") + "</button>"
          : '<span class="carrier">' + (sb.dataset.carrier || "Phoenix") + "</span>") +
        '<span class="clock">' + (sb.dataset.time || "9:41") + "</span>" +
        '<span class="sys">' + PHX_ICON("signal") + PHX_ICON("wifi") +
        '<span class="batt">' + PHX_ICON("battery") + "</span></span>";
    }
    const g = document.querySelector(".gesture");
    if (g) g.innerHTML = '<span class="light"></span>';
    phxIcons();
  };

  window.phxReady = function () {
    phxFrame();
    const imgs = Array.from(document.images).map((im) =>
      im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }));
    Promise.all([document.fonts.ready].concat(imgs)).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; })));
  };
})();
