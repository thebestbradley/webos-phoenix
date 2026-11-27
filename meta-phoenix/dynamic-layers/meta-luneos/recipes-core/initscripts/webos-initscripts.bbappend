# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# webos-initscripts on LuneOS's layers (meta-luneos recipes-core/
# initscripts). (The patch is numbered 2 as in phoenix-ember-glass-ui, whose
# patch 1 makes /var/luna/preferences before prepare-system-dirs stamps it.)
#
# Patch 2: zram-on.sh sizes zram at a quarter of the memory (40 % under
# 1.5 GiB) but counted only /proc/zoneinfo's Normal and HighMem zones, all
# of the memory on 32-bit ARM and only what lies above 4 GiB on arm64: the
# 4 GB VM in UTM got 375 MiB of zram ("free -m", 2.0 Rev 22, 27 November
# 2026; 269 MiB of it used with two cards open) and a 3 GB one the 350 MiB
# floor (2.0 Rev 21's regression serial log: "DISKSIZE/TOTAL_FREE :  350 /
# 0"). It counts MemTotal now: about 980 MiB at 4 GB.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://0002-zram-on-size-zram-from-all-of-the-memory.patch"
