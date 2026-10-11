# Provenance: wallpapers

The first twelve pictures here are drawn by `tools/wallpapers/generate.py` from numbers
alone (gradients, noise, discs, curves and blurs; NumPy and Pillow), each
from a fixed seed, so a run draws the same pictures again. Nothing was
photographed, downloaded, traced or sampled. They are original to webOS
Phoenix and licensed under the Apache License, Version 2.0, like the rest
of the project. Palm's and HP's wallpapers were not in the open-source
release and are not shipped (`docs/LEGAL.md`); these are new pictures made
in their spirit: soft light, bokeh, sky and water, a flower in macro, the
TouchPad's soft swooshes. The photographs after them are described under
"Photographs" below.

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

## Photographs

The phones' and the TouchPad's wallpapers included photographs of nature
close up (smooth stones under water, a clownfish in its anemone, flowers,
water drops). Phoenix has its own photographs of such subjects, after the
drawn ones in Settings' picker: real photographs, each under an open licence
(CC0, or CC BY with the credit below; none CC BY-SA, NC or ND), found on
Wikimedia Commons and checked on its description page (author, licence,
FlickreviewR's check of the Flickr licence where it came from Flickr). Each
was chosen for a composition of its own, not for likeness to Palm's.

`tools/wallpapers/photos.py` fetches each from Commons (a standard rendition
at the size the crop needs), and makes the same changes to all: a square
crop about a chosen point, scaled to 2048 x 2048 (River Stones and Dandelion
up from 1920 px, by a sixteenth); a light Gaussian softening of the grain
(sigma in pixels below) so the JPEG stays near 300 KB; a grade in linear
light (exposure in stops, saturation); and a darkening towards the top
(status bar) and the bottom (launcher labels, quick launch bar), deepened
until white text there has at least 6:1 (top) and 4.5:1 (bottom) contrast
on the screens `--report` checks, or as near as the curve allows. JPEG at
quality 72 to 84, and a 240 x 360 thumbnail in `thumbs/`. Nothing else is
changed, added or removed.

    python3 tools/wallpapers/photos.py            # fetch and prepare them all
    python3 tools/wallpapers/photos.py --report   # white text's contrast on each screen

| File | Photograph | Author | Licence | Source | Changes (crop centre x, y and side of the short side; softening; exposure; saturation; darkening top/reach, bottom/from) |
| --- | --- | --- | --- | --- | --- |
| `river-stones.jpg` (River Stones) | "Smooth Stones", red stones under clear water | Sharon Mollerus | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Smooth_Stones_(2071301568).jpg), from [Flickr](https://www.flickr.com/photos/clairity/2071301568/) | crop 0.5, 0.42, 1.0; 1.0 px; -0.3 stop; 1.0; 0.85/0.34, 0.9/0.5 |
| `clownfish.jpg` (Clownfish) | "Clownfish in Anemone", New York Aquarium | Eden, Janine and Jim | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Clownfish_in_Anemone_(34637539442).jpg), from [Flickr](https://www.flickr.com/photos/edenpictures/34637539442/) | crop 0.5, 0.5, 1.0; 1.0 px; -0.9 stop; 0.9; 0.9/0.45, 0.9/0.5 |
| `jellyfish.jpg` (Jellyfish) | "Lion's mane jellyfish in Gullmarn fjord at Sämstad 8" | W.carter | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Lion%27s_mane_jellyfish_in_Gullmarn_fjord_at_S%C3%A4mstad_8.jpg) (own work) | crop 0.38, 0.4, 0.85; 0.6 px; -0.2 stop; 1.0; 0.5/0.22, 0.9/0.5 |
| `raindrops.jpg` (Raindrops) | "Water Drops", drops on a leaf | kuhnmi | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Water_Drops_(29076462192).jpg), from [Flickr](https://www.flickr.com/photos/31176607@N05/29076462192/) | crop 0.5, 0.5, 1.0; 0.8 px; -0.4 stop; 0.95; 0.9/0.37, 0.9/0.5 |
| `dandelion.jpg` (Dandelion) | "White dandelion seed head pappus macro fluffy texture" | MacrofyStudio | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Commons](https://commons.wikimedia.org/wiki/File:White_dandelion_seed_head_pappus_macro_fluffy_texture.jpg) (own work) | crop 0.5, 0.5, 1.0; 1.0 px; -0.9 stop; 1.0; 0.9/0.5, 0.9/0.5 |
| `gerbera.jpg` (Gerbera) | "Gerber Daisy - Pennsylvania", a red gerbera's heart | Donald Olszewski | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Gerber_Daisy_-_Pennsylvania.jpg), from [Flickr](https://www.flickr.com/photos/186499581@N05/54959532398/) | crop 0.32, 0.5, 1.0; 2.0 px; -0.6 stop; 0.9; 0.9/0.49, 0.5/0.78 |
| `wave.jpg` (Wave) | "crispy curls", a breaking wave at Laguna Beach | Chris Kuga | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Crispy_curls_-_Flickr_-_chris_kuga.jpg), from [Flickr](https://www.flickr.com/photos/126928999@N04/16086023438/) | crop 0.6, 0.5, 1.0; 0.8 px; -0.7 stop; 1.0; 0.9/0.5, 0.5/0.78 |
| `seashells.jpg` (Seashells) | "Shell beach.", shells heaped on a beach | Bernard Spragg. NZ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Commons](https://commons.wikimedia.org/wiki/File:Shell_beach._-_Flickr_-_Bernard_Spragg.jpg), from [Flickr](https://www.flickr.com/photos/volvob12b/20745959392/) | crop 0.5, 0.5, 1.0; 1.2 px; -1.0 stop; 0.9; 0.9/0.49, 0.9/0.5 |

The CC BY photographs are credited as their licences ask in the repository's
`NOTICE` and in Settings > Device Info > Open Source Licenses; the changes are
those above. The CC0 ones are credited too, as a courtesy. The photographers'
works keep their own licences; Phoenix's Apache-2.0 does not cover them.
