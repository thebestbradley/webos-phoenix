# Contrast audit for Aurora Glass: sample the rendered glass behind text
# (text-free strips of each surface) and compute WCAG ratios for the text tokens.
import sys
from PIL import Image
R = sys.argv[1]
def lum(c):
    f = lambda v: (v/255)/12.92 if v/255 <= 0.03928 else (((v/255)+0.055)/1.055)**2.4
    r, g, b = c[:3]; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def hexc(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True); return (la+0.05)/(lb+0.05)
TEXT = {
  'dark':  {'text': '#F3F6FA', 'text-2': '#C3CBD7', 'text-3': '#A6B0BF', 'accent-ink': '#6CF2C4'},
  'light': {'text': '#0B1320', 'text-2': '#313C4E', 'text-3': '#475265', 'accent-ink': '#035C45'},
}
# (render, scale, list of (x0,x1,y0,y1) css strips that are glass without text)
STRIPS = {
  'messaging-list': (2.5, [(9, 13, 80, 920), (433, 437, 80, 920)]),
  'settings': (2.5, [(9, 13, 80, 900), (433, 437, 80, 900)]),
  'messaging-thread': (2.5, [(9, 13, 120, 880), (433, 437, 120, 880)]),
  'email': (2.0, [(10, 16, 50, 760), (268, 274, 250, 760), (670, 680, 120, 740)]),
  'email-selected-row': (2.0, [(272, 276, 156, 236)]),
  'calendar': (2.0, [(10, 16, 50, 760)]),
}
for theme in ('dark', 'light'):
    print(f'== {theme}')
    for name, (s, strips) in STRIPS.items():
        im = Image.open(f'{R}/{name.replace("-selected-row", "")}-{theme}.png').convert('RGB')
        px = []
        for x0, x1, y0, y1 in strips:
            for y in range(int(y0*s), int(y1*s), 6):
                for x in range(int(x0*s), int(x1*s), 3):
                    px.append(im.getpixel((x, y)))
        lo = min(px, key=lum); hi = max(px, key=lum)
        worst = hi if theme == 'dark' else lo
        res = ', '.join(f"{k} {cr(hexc(v), worst):.1f}" for k, v in TEXT[theme].items())
        print(f"{name:17s} bg {'#%02x%02x%02x' % lo}..{'#%02x%02x%02x' % hi}  worst-case: {res}")
