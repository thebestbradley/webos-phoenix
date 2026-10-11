# The wallpapers' pixels (128 x 128, ARGB) for gen_palette.mjs.
#   python3 tools/wallpaper-pixels.py /path/to/webos-phoenix/apps/settings/public/wallpapers > tools/pixels.json
import json, sys
from PIL import Image
W = sys.argv[1].rstrip('/') + '/'
out = {}
for n in ['northern-lights', 'lily-pads']:
    im = Image.open(W + n + '.jpg').convert('RGB').resize((128, 128))
    out[n] = [(0xFF << 24) | (r << 16) | (g << 8) | b for r, g, b in im.getdata()]
json.dump(out, sys.stdout)
