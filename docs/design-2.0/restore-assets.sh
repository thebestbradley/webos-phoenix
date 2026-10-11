#!/bin/sh
# Puts back what the design sources load but the repository leaves out:
# the wallpapers (copies of apps/settings/public/wallpapers) and the fonts
# (SIL OFL, from Google Fonts; LEGAL.md keeps font files out of the tree).
# Then each direction renders again with its own render.cjs:
#   NODE_PATH="$(npm root -g)" node docs/design-2.0/directions/<slug>/render.cjs
set -eu
here=$(cd "$(dirname "$0")" && pwd)
walls="$here/../../apps/settings/public/wallpapers"
dirs="$here/directions"

wall() { cp "$walls/$2" "$dirs/$1/assets/$2"; }
wall aurora-glass northern-lights.jpg
wall aurora-glass silk.jpg
wall aurora-glass twilight.jpg
wall onyx-reborn northern-lights.jpg
wall onyx-reborn silk.jpg
wall phoenix-material northern-lights.jpg
wall phoenix-material lily-pads.jpg
wall ember phoenix.jpg
wall ember-glass phoenix.jpg

# Google Fonts' download of each family, as a variable font.
font() {
    url="https://fonts.google.com/download?family=$2"
    tmp=$(mktemp -d)
    curl -fsSL "$url" -o "$tmp/f.zip" && unzip -q -o "$tmp/f.zip" -d "$tmp" || {
        echo "Could not fetch $2 from Google Fonts: put $3 in $dirs/$1/assets/ by hand." >&2
        rm -rf "$tmp"; return 0; }
    src=$(find "$tmp" -name '*.ttf' ! -name '*Italic*' | head -1)
    case "$3" in
        *.woff2) python3 -c "from fontTools.ttLib import TTFont; f=TTFont('$src'); f.flavor='woff2'; f.save('$dirs/$1/assets/$3')" ;;
        *) cp "$src" "$dirs/$1/assets/$3" ;;
    esac
    rm -rf "$tmp"
}
font aurora-glass Manrope Manrope.ttf
font onyx-reborn Inter Inter.ttf
font phoenix-material Figtree Figtree.woff2
font ember Manrope Manrope.woff2
font ember-glass Manrope Manrope.woff2
echo "Done. Render a direction: NODE_PATH=\"\$(npm root -g)\" node $dirs/<slug>/render.cjs"
