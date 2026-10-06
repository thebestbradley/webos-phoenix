# Provenance of the simulator's toolbar icons

The SVG line icons in `shell/sim/icons/` (phoenix-sim's toolbar and menus:
power, home, back, rotate left and right, screenshot, call, message,
notification, battery, charger, Touchstone, phone, tablet) were drawn for
Phoenix in October 2026, coordinate by coordinate, and are Apache-2.0 like the
rest of the repository. They follow no other icon set and copy nothing from
one; they are simulator chrome, not device art, so they have no Palm original.

They are 24x24, stroked in `currentColor`: phoenix-sim draws them in the
window's text colour (`SimChrome::icon`, `shell/sim/simchrome.cpp`).
