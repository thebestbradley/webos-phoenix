/* Ember: the page runtime for the design renders.
   ?theme=light|dark, ?embed=1 (no device frame: the card as the card view shows it). */
(function () {
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.dataset.theme = q.get('theme') || 'light';
  if (q.get('embed')) root.dataset.embed = '1';

  window.ic = (name, cls = '') => {
    const d = window.ICONS[name];
    if (!d) { console.warn('missing icon', name); return ''; }
    return `<svg class="ic ${cls}" viewBox="${d[0]}" fill="currentColor" aria-hidden="true">${d[1]}</svg>`;
  };
  /* Synergy's merged person: one arc per linked account around the avatar. */
  window.ring = (accs) => {
    if (!accs || accs.length < 2) return '';
    const n = accs.length, gap = 14, r = 47, w = 3.2;
    const pt = a => [r * Math.cos((a - 90) * Math.PI / 180), r * Math.sin((a - 90) * Math.PI / 180)];
    let p = '';
    accs.forEach((acc, i) => {
      const a0 = i * 360 / n + gap / 2 + 20, a1 = (i + 1) * 360 / n - gap / 2 + 20;
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      p += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="var(--${acc})" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
    });
    return `<svg class="ring" viewBox="-50 -50 100 100">${p}</svg>`;
  };
  const hydrate = (el = document) => el.querySelectorAll('i[data-i]').forEach(n => { n.outerHTML = window.ic(n.dataset.i, n.className); });

  /* The webOS frame: status bar with the app menu tab, the card, the gesture light. */
  function frame() {
    document.querySelectorAll('.device').forEach(dev => {
      const app = dev.dataset.app || '';
      const tablet = dev.classList.contains('tablet');
      const wall = document.createElement('div');
      wall.className = 'wall';
      dev.prepend(wall);
      const sb = document.createElement('header');
      sb.className = 'statusbar';
      sb.innerHTML = `
        <div class="appmenu-tab"><span>${app}</span><i data-i="caret-down"></i></div>
        <div class="sb-clock">${tablet ? '<span class="sb-date">Tuesday 13 October</span>' : ''}9:41</div>
        <div class="sb-right">
          ${tablet ? '<span class="sb-notes"><i data-i="chat-circle"></i><i data-i="envelope-simple"></i><span class="dot"></span></span>' : ''}
          <i data-i="cell-signal-full"></i><i data-i="wifi-high"></i><span class="sb-batt"><span class="cell"><i style="width:82%"></i></span>82</span>
        </div>`;
      dev.prepend(sb);
      const g = document.createElement('footer');
      g.className = 'gesture';
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
