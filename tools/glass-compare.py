#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""The small JPEGs in docs/design-2.0/img/system-ui-2/ (docs/SYSTEM-UI-2.md,
"Screenshots"), each of the shell's screenshots beside Ember Glass's render
(docs/design-2.0/img/ember-glass/):

  tools/glass-screenshots.sh SHOTS_DIR
  tools/test-glass-sim.py --out GLASS_SIM_DIR
  tools/glass-compare.py SHOTS_DIR GLASS_SIM_DIR docs/design-2.0/img/system-ui-2

A picture whose screenshots are not there is skipped (and the one in OUT_DIR
kept).

Needs Pillow.
"""
import os
import sys

from PIL import Image

shots, gsim, out = sys.argv[1:4]
R = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs/design-2.0/img/ember-glass')
os.makedirs(out, exist_ok=True)
def load(p, w):
    im = Image.open(p).convert('RGB')
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
def have(*paths):
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        print('skipped (no %s)' % ', '.join(missing))
    return not missing
def pair(a, b, name, w=380, gap=8):
    if not have(a, b):
        return
    A, B = load(a, w), load(b, w)
    h = max(A.height, B.height)
    im = Image.new('RGB', (2 * w + gap, h), (24, 24, 26))
    im.paste(A, (0, 0)); im.paste(B, (w + gap, 0))
    im.save(os.path.join(out, name), quality=82, optimize=True)
pair(f'{R}/cards-dark.jpg', f'{shots}/cards-dark.png', 'cards-dark.jpg')
pair(f'{R}/cards-light.jpg', f'{shots}/cards-light.png', 'cards-light.jpg')
pair(f'{R}/messaging-list-dark.jpg', f'{shots}/app-dark.png', 'app-dark.jpg')
pair(f'{R}/messaging-list-light.jpg', f'{shots}/app-light.png', 'app-light.jpg')
pair(f'{shots}/cards-dark.png', f'{shots}/cards-classic.png', 'cards-classic.jpg')
pair(f'{gsim}/page.png', f'{gsim}/wallpaper.png', 'glass-alignment.jpg')
# Strips: the render's top / bottom over ours, at the renders' 760 px.
def strip(render, ours, box_frac, name):
    if not have(render, ours):
        return
    A = load(render, 760); B = load(ours, 760)
    y0, y1 = box_frac
    a = A.crop((0, round(A.height * y0), 760, round(A.height * y1)))
    b = B.crop((0, round(B.height * y0), 760, round(B.height * y1)))
    im = Image.new('RGB', (760, a.height + b.height + 6), (24, 24, 26))
    im.paste(a, (0, 0)); im.paste(b, (0, a.height + 6))
    im.save(os.path.join(out, name), quality=85, optimize=True)
strip(f'{R}/messaging-list-dark.jpg', f'{shots}/app-dark.png', (0, 0.06), 'statusbar.jpg')
strip(f'{R}/messaging-list-dark.jpg', f'{shots}/app-dark.png', (0.955, 1.0), 'gesture-light.jpg')
strip(f'{R}/cards-dark.jpg', f'{shots}/cards-dark.png', (0.80, 1.0), 'notification-bar.jpg')
# Ours alone (no render draws it on a phone): the bottom of the screen.
def bottom(ours, frac, name):
    if not have(ours):
        return
    B = load(ours, 760)
    B.crop((0, round(B.height * frac), 760, B.height)).save(os.path.join(out, name), quality=85, optimize=True)
bottom(f'{shots}/banner.png', 0.80, 'banner.jpg')
bottom(f'{shots}/dashboard.png', 0.55, 'dashboard.jpg')
bottom(f'{shots}/stacks.png', 0.55, 'stacks.jpg')
def alone(ours, name, w=380):
    if not have(ours):
        return
    load(ours, w).save(os.path.join(out, name), quality=82, optimize=True)
alone(f'{shots}/drawer.png', 'drawer.jpg')
# The system menu, 1.0's beside Ember Glass's: the top right of the screen.
def corner(a, b, name, box=(0.25, 0, 1, 0.55), w=380, gap=8):
    if not have(a, b):
        return
    def crop(p):
        im = Image.open(p).convert('RGB')
        c = im.crop((round(im.width * box[0]), round(im.height * box[1]), round(im.width * box[2]), round(im.height * box[3])))
        return c.resize((w, round(c.height * w / c.width)), Image.LANCZOS)
    A, B = crop(a), crop(b)
    im = Image.new('RGB', (2 * w + gap, max(A.height, B.height)), (24, 24, 26))
    im.paste(A, (0, 0)); im.paste(B, (w + gap, 0))
    im.save(os.path.join(out, name), quality=82, optimize=True)
corner(f'{shots}/systemmenu-classic.png', f'{shots}/systemmenu.png', 'system-menu.jpg')
corner(f'{shots}/systemmenu.png', f'{shots}/systemmenu-wifi.png', 'system-menu-wifi.jpg')
pair(f'{shots}/launcher-classic.png', f'{shots}/launcher.png', 'launcher.jpg')
pair(f'{shots}/launcher-edit.png', f'{shots}/launcher-menu.png', 'launcher-edit-menu.jpg')
alone(f'{shots}/launcher-group.png', 'launcher-group.jpg')
# The sheets, dark and light.
corner(f'{shots}/systemmenu.png', f'{shots}/systemmenu-light.png', 'system-menu-light.jpg')
pair(f'{shots}/launcher-menu.png', f'{shots}/launcher-menu-light.png', 'launcher-light.jpg')
def bottoms(a, b, frac, name, w=380, gap=8):
    if not have(a, b):
        return
    A, B = load(a, w), load(b, w)
    A = A.crop((0, round(A.height * frac), w, A.height)); B = B.crop((0, round(B.height * frac), w, B.height))
    im = Image.new('RGB', (2 * w + gap, max(A.height, B.height)), (24, 24, 26))
    im.paste(A, (0, 0)); im.paste(B, (w + gap, 0))
    im.save(os.path.join(out, name), quality=82, optimize=True)
bottoms(f'{shots}/stacks.png', f'{shots}/stacks-light.png', 0.7, 'stacks-light.jpg')
# The tablet: the status bar beside the tablet renders' (email-dark.jpg),
# 1.0's under both; the card view, the drop-down and a banner.
def bars(render, ours, classic, name, frac=0.045, w=760):
    if not have(render, ours, classic):
        return
    parts = []
    for p in (render, ours, classic):
        im = load(p, w)
        parts.append(im.crop((0, 0, w, round(im.height * frac))))
    out_im = Image.new('RGB', (w, sum(p.height for p in parts) + 12), (24, 24, 26))
    y = 0
    for p in parts:
        out_im.paste(p, (0, y)); y += p.height + 6
    out_im.save(os.path.join(out, name), quality=85, optimize=True)
bars(f'{R}/email-dark.jpg', f'{shots}/tablet-notes.png', f'{shots}/tablet-notes-classic.png', 'tablet-statusbar.jpg')
alone(f'{shots}/tablet-cards.png', 'tablet-cards.jpg', 760)
alone(f'{shots}/tablet-dropdown.png', 'tablet-dropdown.jpg', 760)
def top(ours, frac, name, w=760):
    if not have(ours):
        return
    B = load(ours, w)
    B.crop((0, 0, w, round(B.height * frac))).save(os.path.join(out, name), quality=85, optimize=True)
top(f'{shots}/tablet-banner.png', 0.045, 'tablet-banner.jpg')
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
