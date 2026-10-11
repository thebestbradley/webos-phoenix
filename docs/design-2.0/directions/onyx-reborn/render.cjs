// Renders every screen of this direction to renders/<screen>-<theme>.png.
//   NODE_PATH="$(npm root -g)" node render.cjs [screen ...]
// Phone: CSS 446x994 at deviceScaleFactor 2.5 (the Fairphone 6's 1116x2484
// panel, give or take a pixel); tablet: CSS 1280x800 at 2.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const PHONE = { width: 446, height: 994, dpr: 2.5 };
const TABLET = { width: 1280, height: 800, dpr: 2 };
const SCREENS = [
  { name: "messaging-list", size: PHONE },
  { name: "messaging-thread", size: PHONE },
  { name: "email", size: TABLET },
  { name: "calendar", size: TABLET },
  { name: "settings", size: PHONE },
  { name: "music", size: PHONE },
  { name: "components", size: { width: 1280, height: 900, dpr: 2 } },
  { name: "cards", size: PHONE, themes: ["dark", "light"] },
];

(async () => {
  const only = process.argv.slice(2);
  const out = path.join(__dirname, "renders");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const s of SCREENS) {
    if (only.length && !only.includes(s.name)) continue;
    for (const theme of s.themes || ["light", "dark"]) {
      const ctx = await browser.newContext({
        viewport: { width: s.size.width, height: s.size.height },
        deviceScaleFactor: s.size.dpr,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(s.name, theme, e.message));
      const url = "file://" + path.join(__dirname, "screens", s.name + ".html") + "?theme=" + theme;
      await page.goto(url);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
      // let iframes (the card view) settle too
      await page.waitForTimeout(s.name === "cards" ? 1500 : 250);
      const file = path.join(out, `${s.name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log("wrote", path.relative(__dirname, file));
      await ctx.close();
    }
  }
  await browser.close();
})();
