// Ember Glass: renders every screen of this direction, light and dark, with Playwright's Chromium.
//   NODE_PATH="$(npm root -g)" node render.cjs [filter...]   (then the contact sheet)
// Phone: CSS 446x994 at 2.5x (the Fairphone 6's 1116x2484); tablet: CSS 1280x800 at 2x.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PHONE = { width: 446, height: 994, dsf: 2.5 };
const TABLET = { width: 1280, height: 800, dsf: 2 };
// [output name, source, size]
const SCREENS = [
  ['messaging-list', 'messaging-list', PHONE],
  ['messaging-thread', 'messaging-thread', PHONE],
  ['settings', 'settings', PHONE],
  ['music', 'music', PHONE],
  ['email', 'email', TABLET],
  ['calendar', 'calendar', TABLET],
  ['components', 'components', { width: 1280, height: 1000, dsf: 2 }],
  ['cards', 'cards', PHONE],
];

(async () => {
  const only = process.argv.slice(2);
  const out = path.join(__dirname, 'renders');
  fs.mkdirSync(out, { recursive: true });
  // Ember Glass: composite on the GPU path (SwiftShader GL). Chromium's software compositor drops a large
  // backdrop blur at 2x and 2.5x (the text under a toolbar stays sharp); a device GPU and SwiftShader do not.
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, src, size] of SCREENS) {
    if (only.length && !only.some(f => name.includes(f))) continue;
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dsf });
      page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log(`  [${name}] ${m.text()}`); });
      const url = 'file://' + path.join(__dirname, 'screens', src + '.html') + `?theme=${theme}`;
      await page.goto(url);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
      // the card view's cards are the screens themselves, in frames: wait for each
      await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => f.src), null, { timeout: 30000 });
      await page.waitForLoadState('load');
      for (const f of page.frames()) await f.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
      await page.waitForTimeout(150);
      const file = path.join(out, `${name}-${theme}.png`);
      // capture can fail transiently on a busy machine: try again before giving up
      for (let i = 0; ; i++) { try { await page.screenshot({ path: file }); break; } catch (e) { if (i >= 2) throw e; await page.waitForTimeout(500); } }
      await page.close();
      console.log('rendered', path.relative(__dirname, file));
    }
  }
  if (!only.length || only.includes('contact')) {
    const page = await browser.newPage({ viewport: { width: 2600, height: 800 }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(__dirname, 'contact.html'));
    await page.waitForFunction(() => window.__ready === true);
    await page.screenshot({ path: path.join(__dirname, 'contact-sheet.png'), fullPage: true });
    console.log('rendered contact-sheet.png');
  }
  await browser.close();
  // Smaller files: re-encode losslessly with the best zlib settings (Pillow), when it is there.
  try { execFileSync('python3', ['-I', '-c', `
import sys, glob, os
from PIL import Image
for f in glob.glob(os.path.join(sys.argv[1], 'renders', '*.png')) + [os.path.join(sys.argv[1], 'contact-sheet.png')]:
    if os.path.exists(f):
        Image.open(f).convert('RGB').save(f, optimize=True)
`, __dirname], { stdio: 'inherit' }); } catch (e) { console.log('(PNG optimisation skipped)'); }
})();
