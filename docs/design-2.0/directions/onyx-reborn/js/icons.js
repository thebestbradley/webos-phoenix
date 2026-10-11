// Phoenix 2.0 exploration glyphs: drawn for these mock-ups (Apache-2.0 with
// the project), on a 24-unit grid, stroked with currentColor. No third-party art.
// <i data-i="wifi"></i> becomes an inline <svg>.
(function () {
  const S = {
    wifi: '<path d="M2.6 9.2a14 14 0 0 1 18.8 0"/><path d="M5.9 12.6a9.2 9.2 0 0 1 12.2 0"/><path d="M9.2 16a4.4 4.4 0 0 1 5.6 0"/><circle cx="12" cy="19.2" r="1.3" class="f"/>',
    signal: '<rect x="3" y="15" width="3.2" height="5" rx="1" class="f"/><rect x="8" y="11.5" width="3.2" height="8.5" rx="1" class="f"/><rect x="13" y="8" width="3.2" height="12" rx="1" class="f"/><rect x="18" y="4" width="3.2" height="16" rx="1" class="f" opacity=".35"/>',
    battery: '<rect x="2.5" y="7" width="17" height="10" rx="3"/><path d="M21.5 10.5v3"/><rect x="5" y="9.5" width="9.5" height="5" rx="1.3" class="f"/>',
    bluetooth: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>',
    airplane: '<path d="M10.5 3.8c0-1 .7-1.8 1.5-1.8s1.5.8 1.5 1.8V9l7.5 4.6v2.2L13.5 13.5v4.6l2.3 1.8V22L12 20.8 8.2 22v-2.1l2.3-1.8v-4.6L3 15.8v-2.2L10.5 9z"/>',
    shield: '<path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.9-4.4-1.5-7.5-5.3-7.5-9.9V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M3.5 17.5l5-4.5 3.5 3 3-2.5 5.5 4.5"/>',
    speaker: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
    pencil: '<path d="M4 20l1.1-4.4L16.3 4.4a2.1 2.1 0 0 1 3 3L8.4 18.9z"/><path d="M14.3 6.4l3 3"/>',
    compose: '<path d="M11 4.5H6.5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V13"/><path d="M9.5 14.5l.6-3L18 3.6a1.8 1.8 0 0 1 2.5 2.5l-7.9 7.8z"/>',
    send: '<path d="M12 19.5V5"/><path d="M5.8 11L12 4.8l6.2 6.2"/>',
    plane: '<path d="M3.5 11.2L20.5 4l-6.6 16.5-2.7-6.8z"/><path d="M11.2 13.7L20.5 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    chevD: '<path d="M6 9.5l6 6 6-6"/>',
    chevU: '<path d="M6 14.5l6-6 6 6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    reply: '<path d="M9.5 6.5L4 12l5.5 5.5"/><path d="M4.5 12H14a6 6 0 0 1 6 6v.5"/>',
    replyAll: '<path d="M8 6.5L2.5 12 8 17.5"/><path d="M12.5 6.5L7 12l5.5 5.5"/><path d="M7.5 12H15a6 6 0 0 1 6 6v.5"/>',
    forward: '<path d="M14.5 6.5L20 12l-5.5 5.5"/><path d="M19.5 12H10a6 6 0 0 0-6 6v.5"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.3 4.2 2.3 4.3H5.5"/>',
    flagF: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.3 4.2 2.3 4.3H5.5z" class="f"/>',
    inbox: '<path d="M3.5 13.5L6.2 5.5h11.6l2.7 8V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5h4.8l1.4 2.5h4.6l1.4-2.5h4.8"/>',
    doc: '<path d="M6.5 3h7.5l4.5 4.5V19a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M13.5 3v5h5M8.5 13h7M8.5 16.5h5"/>',
    trash: '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.2h5v2.3"/><path d="M6 6.5l1 13.2a1.6 1.6 0 0 0 1.6 1.5h6.8a1.6 1.6 0 0 0 1.6-1.5l1-13.2"/><path d="M10 10.5v6.5M14 10.5v6.5"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M4.5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
    clip: '<path d="M19 11.5l-7.2 7.2a4.6 4.6 0 0 1-6.5-6.5l7.6-7.6a3.1 3.1 0 0 1 4.4 4.4l-7.5 7.5a1.6 1.6 0 0 1-2.3-2.3l6.9-6.9"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    play: '<path d="M8 5.2v13.6a1 1 0 0 0 1.5.9l10.6-6.8a1 1 0 0 0 0-1.7L9.5 4.3A1 1 0 0 0 8 5.2z" class="f"/>',
    pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.3" class="f"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.3" class="f"/>',
    prev: '<path d="M18.5 6.2v11.6a.9.9 0 0 1-1.4.8L9 13a1.2 1.2 0 0 1 0-2l8.1-5.6a.9.9 0 0 1 1.4.8z" class="f"/><rect x="5" y="5.5" width="2.6" height="13" rx="1" class="f"/>',
    next: '<path d="M5.5 6.2v11.6a.9.9 0 0 0 1.4.8L15 13a1.2 1.2 0 0 0 0-2L6.9 5.4a.9.9 0 0 0-1.4.8z" class="f"/><rect x="16.4" y="5.5" width="2.6" height="13" rx="1" class="f"/>',
    shuffle: '<path d="M3.5 7h3.2c2.3 0 3.6 1.2 4.8 3.3l1 1.7c1.2 2.1 2.5 3.3 4.8 3.3h3.2"/><path d="M3.5 17h3.2c1.6 0 2.7-.6 3.6-1.6M13.9 8.6c.9-1 2-1.6 3.6-1.6h3"/><path d="M18 4.5l2.5 2.5L18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
    repeat: '<path d="M4 11.5V10a3 3 0 0 1 3-3h13"/><path d="M17 4l3 3-3 3"/><path d="M20 12.5V14a3 3 0 0 1-3 3H4"/><path d="M7 20l-3-3 3-3"/>',
    heart: '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 6.9a4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/>',
    heartF: '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 6.9a4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z" class="f"/>',
    queue: '<path d="M4 6.5h11M4 11.5h11M4 16.5h7"/><path d="M16 14.5v6l4.5-3z" class="f"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" class="f"/><circle cx="12" cy="12" r="1.6" class="f"/><circle cx="18.5" cy="12" r="1.6" class="f"/>',
    moreV: '<circle cx="12" cy="5.5" r="1.6" class="f"/><circle cx="12" cy="12" r="1.6" class="f"/><circle cx="12" cy="18.5" r="1.6" class="f"/>',
    person: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 13.6a6.5 6.5 0 0 1 4 5.9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.8 7l8.2 6 8.2-6"/>',
    chat: '<path d="M4 6.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6.5L6 20.5v-4H7a3 3 0 0 1-3-3z"/>',
    music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    phone: '<path d="M5 3.5h3.2l1.6 4.4-2.2 1.5a11.5 11.5 0 0 0 7 7l1.5-2.2 4.4 1.6V19a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5z"/>',
    video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/>',
    camera: '<path d="M4 8.5a2 2 0 0 1 2-2h2.2L9.8 4h4.4l1.6 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M7.5 14.5h9"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5M12 3.5C9.6 5.9 8.4 8.7 8.4 12s1.2 6.1 3.6 8.5"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.6 2.5 2.9-.6.6 2.9 2.5 1.6-1.4 2.6 1.4 2.6-2.5 1.6-.6 2.9-2.9-.6L12 21.2l-1.6-2.5-2.9.6-.6-2.9-2.5-1.6L5.8 12 4.4 9.4l2.5-1.6.6-2.9 2.9.6z"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    type: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
    hotspot: '<circle cx="12" cy="12" r="1.8" class="f"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    at: '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.3a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4"/>',
    up: '<path d="M7 14l5-5 5 5"/>',
    sparkle: '<path d="M12 3.5l1.7 5.2 5.3 1.8-5.3 1.8L12 17.5l-1.7-5.2L5 10.5l5.3-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    rotate: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M18 3.5v4h-4"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M6 20.5v-4h4"/>',
  };
  function svg(name, cls) {
    const body = S[name] || "";
    return '<svg viewBox="0 0 24 24" class="ic ' + (cls || "") + '" aria-hidden="true">' + body + "</svg>";
  }
  window.PHX_ICON = svg;
  window.PHX_ICONS = S;
  window.phxIcons = function (root) {
    (root || document).querySelectorAll("i[data-i]").forEach(function (el) {
      const wrap = document.createElement("span");
      wrap.innerHTML = svg(el.dataset.i, el.className);
      el.replaceWith(wrap.firstChild);
    });
  };
})();
