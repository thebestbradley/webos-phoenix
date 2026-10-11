# contact.py <direction dir> <title> <subtitle> <font.ttf> <bg hex> <accent hex>
import sys
from PIL import Image, ImageDraw, ImageFont
d, title, sub, fontp, bg, acc = sys.argv[1:7]
R = d + '/renders/'
def font(size, w):
    f = ImageFont.truetype(fontp, size)
    try: f.set_variation_by_axes([w] if 'Manrope' in fontp else [14 if size < 20 else 28, w])
    except Exception: pass
    return f
PH_H, TAB_W, GAP, M = 640, 500, 24, 48
phones = [('messaging-list', 'Messaging · list'), ('messaging-thread', 'Messaging · conversation'), ('settings', 'Settings'), ('music', 'Music · now playing'), ('cards', 'Card view')]
tabs = [('email', 'Email · tablet'), ('calendar', 'Calendar · tablet'), ('components', 'Component sheet')]
def thumb(path, w=None, h=None, r=14):
    im = Image.open(path).convert('RGB')
    if h: w = round(im.width * h / im.height)
    else: h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
    return im, mask
pw = round(1115 * PH_H / 2485)
W = M * 2 + max(5 * pw + 4 * GAP, 3 * TAB_W + 2 * GAP)
th_c = round(1800 * TAB_W / 2560)
H = 130 + 2 * (34 + PH_H + 36) + 2 * (34 + th_c + 36) + 20
sheet = Image.new('RGB', (W, H), bg)
dr = ImageDraw.Draw(sheet)
dr.text((M + 22, 92), sub, font=font(19, 500), fill='#AEB6C2')
dr.rounded_rectangle((M, 38, M + 7, 118), 3, fill=acc)
dr.text((M + 22, 36), title, font=font(40, 800 if 'Manrope' in fontp else 700), fill='#FFFFFF')
lab = font(16, 600)
y = 130
for theme in ('light', 'dark'):
    x0 = (W - (5 * pw + 4 * GAP)) // 2
    for i, (n, l) in enumerate(phones):
        x = x0 + i * (pw + GAP)
        dr.text((x + 2, y + 8), f'{l} · {theme}', font=lab, fill='#C9D0DA')
        im, mk = thumb(R + f'{n}-{theme}.png', h=PH_H)
        sheet.paste(im, (x, y + 34), mk)
    y += 34 + PH_H + 36
for theme in ('light', 'dark'):
    x0 = (W - (3 * TAB_W + 2 * GAP)) // 2
    for i, (n, l) in enumerate(tabs):
        x = x0 + i * (TAB_W + GAP)
        dr.text((x + 2, y + 8), f'{l} · {theme}', font=lab, fill='#C9D0DA')
        im, mk = thumb(R + f'{n}-{theme}.png', w=TAB_W, r=10)
        sheet.paste(im, (x, y + 34), mk)
    y += 34 + th_c + 36
sheet.save(d + '/contact-sheet.png', optimize=True)
print('wrote', d + '/contact-sheet.png', sheet.size)
