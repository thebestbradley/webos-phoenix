# Provenance: wallpapers

Every picture here is drawn by `tools/wallpapers/generate.py` from numbers
alone (gradients, noise, discs, curves and blurs; NumPy and Pillow), each
from a fixed seed, so a run draws the same pictures again. Nothing was
photographed, downloaded, traced or sampled. They are original to webOS
Phoenix and licensed under the Apache License, Version 2.0, like the rest
of the project. Palm's and HP's wallpapers were not in the open-source
release and are not shipped (`docs/LEGAL.md`); these are new pictures made
in their spirit: soft light, bokeh, sky and water, a flower in macro, the
TouchPad's soft swooshes.

    python3 tools/wallpapers/generate.py            # all of them
    python3 tools/wallpapers/generate.py --report   # white text's contrast on each screen

| File | Seed | Picture |
| --- | --- | --- |
| `northern-lights.jpg` (the default) | 1101 | Aurora curtains, green fading to violet, over stars, a far ridge and spruce |
| `phoenix.jpg` | 1102 | Abstract fire: two wings of flame-light rising from an ember glow, sparks |
| `twilight.jpg` | 1103 | Blue and violet lights far out of focus (bokeh) |
| `amber.jpg` | 1104 | Warm gold bokeh, as through a window at dusk |
| `garden.jpg` | 1105 | Green and soft yellow bokeh, sun through leaves |
| `sea-and-sky.jpg` | 1106 | A calm sea under an evening sky, the sun low, its path on the water |
| `dawn.jpg` | 1107 | First light over layered hills in mist |
| `silk.jpg` | 1108 | Soft ribbons of blue light sweeping across a deep blue |
| `midnight.jpg` | 1109 | The Milky Way across a clear night sky |
| `bloom.jpg` | 1110 | A pink flower in macro, soft focus but for its heart |
| `shallows.jpg` | 1111 | Caustics: sunlight's net on the sand under shallow water |
| `linen.jpg` | 1112 | A dark woven texture |

Each is a 2048 x 2048 square (the TouchPad's 1024 x 1024 at 2x), JPEG at
quality 84 with a little grain and dither against banding; the shell crops
it to the screen about the centre (`shell/qml/Phoenix/Shell/Wallpaper.qml`).
`thumbs/` holds a 240 x 360 crop of the centre of each, for Settings'
picker.
