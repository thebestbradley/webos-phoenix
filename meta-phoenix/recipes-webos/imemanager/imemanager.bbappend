# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# OSE's keyboard (imemanager, libplugin-global.so) stays installed: it is
# "webOS OSE" in Settings > Text Assist > Keyboards (GAPS V7), beside the
# Phoenix keyboard, which is the default (phoenix-keyboard,
# maliit-framework-webos bbappend).
#
# Its recipe also installs maliit-server's bus role
# (ime-manager service/com.webos.service.ime.role.json.in): the role of
# every plugin maliit-server loads, the Phoenix keyboard's too. Its
# outbound list names the services OSE's keyboard calls; luna-service2 lets
# a client call only those (ls-hubd security.cpp:684-700,
# LSHubIsClientAllowedOutbound), and a second role for the same executable
# would be skipped (service_permissions.cpp:110-141). So the list gets the
# services the Phoenix keyboard calls (Phoenix/Keyboard/MaliitKeyboard.qml):
# the preferences (com.webos.service.systemservice), audiod's playSound
# (com.webos.service.audio), the clipboard history (org.webosphoenix.clipboard),
# the learned words (com.palm.systemmanager). Their API groups are granted in
# phoenix-keyboard's client permissions (com.webos.service.ime.phoenix.perm.json).

PHOENIX_KEYBOARD_OUTBOUND = '"com.webos.service.systemservice","com.webos.service.audio","org.webosphoenix.clipboard","com.palm.systemmanager",'

do_install:append() {
    # ime-manager.pro: CONFIG += webos-service, WEBOS_SYSBUS_DIR = service
    # (to ${datadir}/luna-service2/roles.d).
    role=$(find ${D} -name com.webos.service.ime.role.json | head -n 1)
    if [ -z "$role" ]; then
        bbfatal "phoenix-keyboard: maliit-server's role (com.webos.service.ime.role.json) is not installed"
    fi
    sed -i 's/"outbound"[[:space:]]*:[[:space:]]*\[/&${PHOENIX_KEYBOARD_OUTBOUND}/' "$role"
    grep -q '"org.webosphoenix.clipboard"' "$role" || bbfatal "phoenix-keyboard: maliit-server's role was not changed"
}
