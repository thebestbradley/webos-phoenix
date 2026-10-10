# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Phoenix keyboard (phoenix-keyboard, libphoenix-keyboard.so) is the
# device's input method (GAPS V5); OSE's own (imemanager's
# libplugin-global.so) stays installed beside it, a keyboard the user can
# switch to (Settings > Text Assist > Keyboards, "webOS OSE"; the globe key).
# docs/HARDWARE.md, "The keyboard as the input method".
#
# maliit-server picks its on-screen plugin from its settings
# (/var/lib/maliit/server.conf, a QSettings file: maliit/onscreen/active,
# else MALIIT_DEFAULT_PLUGIN, mimonscreenplugins.cpp:178-183), and switches
# only to plugins listed in maliit/onscreen/enabled
# (mimpluginmanager.cpp:648-653). maliit-server.sh writes that file on the
# first boot (meta-webos maliit-server.sh, the "onscreen\enabled" list).

# (Named for the recipe as OSE has it, unversioned: maliit-framework-webos.bb;
# a "_%" append would not apply to it.)

# The default: Phoenix's, not OSE's (maliit-framework-webos.bb passes
# MALIIT_DEFAULT_PLUGIN=libplugin-global.so to qmake).
EXTRA_QMAKEVARS_PRE:remove = "MALIIT_DEFAULT_PLUGIN=libplugin-global.so"
EXTRA_QMAKEVARS_PRE += "MALIIT_DEFAULT_PLUGIN=libphoenix-keyboard.so"

# The first boot's settings: Phoenix's keyboard enabled (first) and active,
# OSE's and the others enabled after it.
do_install:append() {
    script=$(find ${D} -name maliit-server.sh | head -n 1)
    if [ -z "$script" ]; then
        bbfatal "phoenix-keyboard: maliit-server.sh is not installed where expected"
    fi
    sed -i '/^ *echo "libplugin-global.so:, /i echo "libphoenix-keyboard.so:, \\\\" >> $MALIIT_CONF_FILE' "$script"
    sed -i '/^ *echo "onscreen\\\\enabled= /i echo "onscreen\\\\active=libphoenix-keyboard.so:" >> $MALIIT_CONF_FILE' "$script"
    grep -q 'libphoenix-keyboard.so:, ' "$script" || bbfatal "phoenix-keyboard: maliit-server.sh's enabled list was not changed"
    grep -q 'active=libphoenix-keyboard.so:' "$script" || bbfatal "phoenix-keyboard: maliit-server.sh's active plugin was not set"
}
