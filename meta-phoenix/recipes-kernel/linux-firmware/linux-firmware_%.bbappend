# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# PHOENIX_FIRMWARE_COMPRESS (docs/HARDWARE.md, "Firmware in the image"):
# "" (the default: the files as linux-firmware ships them), "xz" or "zstd".
# Set, the firmware files are compressed after do_install, as upstream's
# copy-firmware.sh --xz / --zstd does: each file becomes file.xz (xz with
# CRC32 checks, which the kernel needs) or file.zst, a link to a compressed
# file is made again with the suffix (link.xz -> target.xz), and the
# licence files stay as they are (the Device Info licence pages read them).
# The kernel finds them through CONFIG_FW_LOADER_COMPRESS_XZ / _ZSTD
# (phoenix-hardware.cfg). Each package's FILES patterns also match the
# compressed names.

PHOENIX_FIRMWARE_COMPRESS ??= ""

DEPENDS:append = "${@ {'xz': ' xz-native', 'zstd': ' zstd-native'}.get(d.getVar('PHOENIX_FIRMWARE_COMPRESS') or '', '')}"

python () {
    comp = d.getVar("PHOENIX_FIRMWARE_COMPRESS") or ""
    if comp not in ("", "xz", "zstd"):
        bb.fatal('PHOENIX_FIRMWARE_COMPRESS: "", "xz" or "zstd", not "%s"' % comp)
    if not comp:
        return
    ext = ".xz" if comp == "xz" else ".zst"
    import re
    for pkg in (d.getVar("PACKAGES") or "").split():
        files = d.getVar("FILES:" + pkg)
        if not files:
            continue
        # A pattern for a file (not a folder, not ending in a glob) also
        # matches the file compressed.
        more = [p + ext for p in files.split()
                if "/firmware/" in p and not p.endswith(("*", "/")) and not re.search(r"/(LICEN[CS]E|WHENCE)[^/]*$", p)]
        if more:
            d.setVar("FILES:" + pkg, files + " " + " ".join(more))
}

python do_phoenix_compress_firmware () {
    import os, re, subprocess
    comp = d.getVar("PHOENIX_FIRMWARE_COMPRESS") or ""
    if not comp:
        return
    ext = ".xz" if comp == "xz" else ".zst"
    cmd = ["xz", "--compress", "--quiet", "--check=crc32", "-T1"] if comp == "xz" else ["zstd", "--compress", "--quiet", "-19", "--rm"]
    root = d.expand("${D}${nonarch_base_libdir}/firmware")
    keep = re.compile(r"^(LICEN[CS]E|WHENCE|README|GPL|COPYING)")
    before = after = 0
    links = []
    for top, dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(top, f)
            if os.path.islink(p):
                links.append(p)
                continue
            if keep.match(f) or f.endswith((".xz", ".zst")):
                continue
            before += os.path.getsize(p)
            subprocess.check_call(cmd + [p])
            after += os.path.getsize(p + ext)
    # Links to a compressed file point at it again, with the suffix (again
    # until none is left: a link to a link follows once that one has moved).
    for _ in range(8):
        moved = False
        for p in [x for x in links if os.path.islink(x)]:
            target = os.readlink(p)
            resolved = os.path.join(os.path.dirname(p), target)
            if not os.path.lexists(resolved) and os.path.lexists(resolved + ext):
                os.unlink(p)
                os.symlink(target + ext, p + ext)
                moved = True
        if not moved:
            break
    bb.note("Firmware compressed with %s: %.1f MB to %.1f MB" % (comp, before / 1e6, after / 1e6))
}
addtask phoenix_compress_firmware after do_install before do_package
# ${D} belongs to pseudo, as in do_install.
do_phoenix_compress_firmware[fakeroot] = "1"
