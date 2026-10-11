/* Phoenix Material: the page runtime for the design renders.
   ?theme=light|dark, ?wall=northern-lights|lily-pads (the dynamic colour's source),
   ?embed=1 (no device frame: the card as the card view shows it). */
(function () {
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.dataset.theme = q.get('theme') || 'light';
  root.dataset.wall = q.get('wall') || root.dataset.wall || 'northern-lights';
  if (q.get('embed')) root.dataset.embed = '1';

  window.ic = (name, cls = '') => {
    const d = window.ICONS[name];
    if (!d) { console.warn('missing icon', name); return ''; }
    return `<svg class="ic ${cls}" viewBox="${d[0]}" fill="currentColor" aria-hidden="true">${d[1]}</svg>`;
  };
  const hydrate = (el = document) => el.querySelectorAll('i[data-i]').forEach(n => { n.outerHTML = window.ic(n.dataset.i, n.className); });

  /* The webOS frame: status bar with the app menu tab, the card, the gesture area. */
  function frame() {
    document.querySelectorAll('.device').forEach(dev => {
      const app = dev.dataset.app || '';
      const tablet = dev.classList.contains('tablet');
      const wall = document.createElement('div');
      wall.className = 'wall';
      dev.prepend(wall);
      const sb = document.createElement('header');
      sb.className = 'statusbar glass';
      sb.innerHTML = `
        <div class="appmenu-tab"><span>${app}</span><i data-i="keyboard_arrow_down"></i></div>
        <div class="sb-clock">${tablet ? '<span class="sb-date">Tue 13 Oct</span>' : ''}9:41</div>
        <div class="sb-right">
          ${tablet ? '<span class="sb-notes"><i data-i="chat_bubble-fill"></i><i data-i="mail-fill"></i></span>' : ''}
          <i data-i="signal_cellular_4_bar"></i><i data-i="wifi"></i><span class="sb-batt"><i data-i="battery_5_bar"></i>82%</span>
        </div>`;
      dev.prepend(sb);
      const g = document.createElement('footer');
      g.className = 'gesture glass';
      g.innerHTML = '<div class="gesture-light"></div>';
      dev.append(g);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!root.dataset.embed) frame();
    if (window.build) window.build();
    hydrate();
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    window.__ready = true;
  });
})();
