// Ember Glass: WCAG contrast of every visible text run against the pixels actually behind it (glass,
// blur and wallpaper included). Collects each run's box and colour, renders the page again with all text
// hidden, then tools/glass_contrast.py measures the worst point under each run.
//   NODE_PATH="$(npm root -g)" node tools/glass-contrast.cjs [screen...]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PHONE = { width: 446, height: 994 }, TABLET = { width: 1280, height: 800 };
const SCREENS = [['messaging-list', PHONE], ['messaging-thread', PHONE], ['settings', PHONE], ['music', PHONE], ['cards', PHONE],
  ['email', TABLET], ['calendar', TABLET], ['components', { width: 1280, height: 1000 }]];
(async () => {
  const only = process.argv.slice(2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-contrast-'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const jobs = [];
  for (const [name, size] of SCREENS) {
    if (only.length && !only.includes(name)) continue;
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
      await page.goto('file://' + path.join(ROOT, 'screens', name + '.html') + '?theme=' + theme);
      await page.waitForFunction(() => window.__ready === true);
      await page.waitForTimeout(200);
      const runs = await page.evaluate(() => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const masked = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.maskImage && cs.maskImage !== 'none' || cs.webkitMaskImage && cs.webkitMaskImage !== 'none') return e; } return null; };
        for (let n; (n = walker.nextNode());) {
          const t = n.textContent.trim(); if (!t) continue;
          const el = n.parentElement, cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
          const fill = cs.webkitTextFillColor, clipText = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
          const r = document.createRange(); r.selectNodeContents(n);
          const m = masked(el), mb = m ? m.getBoundingClientRect() : null;
          for (const rc of r.getClientRects()) {
            if (rc.width < 2 || rc.height < 2) continue;
            const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
            const top = document.elementFromPoint(Math.min(cx, rc.left + 8), cy);
            if (top && !(top === el || el.contains(top) || top.contains(el))) continue;   // covered (under a bar or a pane)
            if (mb && (rc.bottom > mb.bottom - 70 && m.classList.contains('fade-bottom'))) continue;   // in a scroll fade
            out.push({ t: t.slice(0, 40), x: rc.left, y: rc.top, w: rc.width, h: rc.height, color: clipText ? 'gradient' : (fill && fill !== cs.color ? fill : cs.color), op,
              size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight), cls: (el.className && el.className.baseVal === undefined ? el.className : '') });
          }
        }
        return out;
      });
      await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }' });
      await page.waitForTimeout(150);
      const png = path.join(tmp, `${name}-${theme}.png`);
      for (let i = 0; ; i++) { try { await page.screenshot({ path: png }); break; } catch (e) { if (i > 3) throw e; await page.waitForTimeout(400); } }
      fs.writeFileSync(png + '.json', JSON.stringify(runs));
      jobs.push(png);
      await page.close();
    }
  }
  await browser.close();
  execFileSync('python3', ['-I', path.join(__dirname, 'glass_contrast.py'), ...jobs], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
})();
