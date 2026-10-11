# Ember Glass: the measuring half of glass-contrast.cjs. For each text run: the text colour (with its alpha
# and the opacity of its ancestors) over every background pixel under the middle of its box; the 2nd
# percentile of the per-pixel contrast is the run's worst case (ignores the odd hairline crossing a box).
import sys, json, re, os
import numpy as np
from PIL import Image
def lin(c):
    c = np.asarray(c, dtype=float) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lum(rgb): l = lin(rgb); return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]
def parse(c):
    m = re.match(r'rgba?\(([^)]+)\)', c)
    if not m: return None
    v = [float(x) for x in re.split(r'[ ,/]+', m.group(1).strip()) if x]
    return v[:3], (v[3] if len(v) > 3 else 1.0)
total_fail = 0; total_runs = 0; by_colour = {}
for png in sys.argv[1:]:
    runs = json.load(open(png + '.json'))
    im = np.asarray(Image.open(png).convert('RGB'), dtype=float)
    rows, fails = [], 0
    for r in runs:
        if r['color'] == 'gradient': continue
        p = parse(r['color'])
        if not p: continue
        rgb, a = p; a *= r['op']
        if a < 0.05: continue
        x0, x1 = int(r['x']), int(r['x'] + r['w']); y0, y1 = int(r['y'] + r['h'] * .2), int(r['y'] + r['h'] * .8)
        bg = im[max(y0, 0):max(y1, 1), max(x0, 0):max(x1, 1)].reshape(-1, 3)
        if not len(bg): continue
        txt = np.array(rgb) * a + bg * (1 - a)
        lt, lb = lum(txt), lum(bg)
        cr = (np.maximum(lt, lb) + .05) / (np.minimum(lt, lb) + .05)
        worst = float(np.percentile(cr, 2))
        large = r['size'] >= 24 or (r['size'] >= 18.66 and r['weight'] >= 700)
        need = 3.0 if large else 4.5
        rows.append((worst, need, r))
        theme = 'dark' if png.endswith('-dark.png') else 'light'
        k = (theme, r['color'] if r['op'] >= .99 else r['color'] + f' x{r["op"]:.2f}')
        if k not in by_colour or worst < by_colour[k][0]: by_colour[k] = (worst, os.path.basename(png)[:-4], r['t'][:24])
        if worst < need: fails += 1
    rows.sort(key=lambda x: x[0] / x[1])
    name = os.path.basename(png)[:-4]
    print(f'{name:26s} runs {len(rows):3d}  failing {fails:2d}  worst ' + '  '.join(f'{w:4.1f} "{r["t"][:18]}"' for w, n, r in rows[:3]))
    for w, n, r in rows:
        if w < n: print(f'    FAIL {w:4.2f} < {n}  "{r["t"]}"  {r["color"]} x{r["op"]:.2f} {r["size"]}px/{r["weight"]} .{r["cls"]}')
    total_fail += fails; total_runs += len(rows)
print('worst case per text colour (theme, colour: ratio, where):')
for (theme, col), (w, where, t) in sorted(by_colour.items(), key=lambda kv: (kv[0][0], kv[1][0])):
    print(f'  {theme:5s} {col:28s} {w:5.2f}  {where} "{t}"')
print('runs:', total_runs, ' failing runs:', total_fail)
