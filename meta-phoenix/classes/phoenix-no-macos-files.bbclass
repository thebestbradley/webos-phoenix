# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# No macOS Finder files in a package. A checkout or a staged source tree
# that a Mac has browsed holds Finder's .DS_Store files, AppleDouble "._*"
# files (a Mac's metadata on a disk that is not APFS or HFS+) and
# .localized markers. Copied into ${D} with a tree, they are files no
# package ships, and do_package stops (QA installed-vs-shipped), as it did
# twice on 28 November 2026 for /.DS_Store and /usr/.DS_Store
# (compat/rootfs). install-rootfs.py already leaves them out; this is the
# rule for every recipe that installs trees from this repository
# (tools/devicecheck/recipes.py, "macos-files", checks that each inherits
# it).
#
#   inherit phoenix-no-macos-files
#
# In a recipe, do_install ends by deleting them under ${D}. In an image, a
# ROOTFS_POSTPROCESS_COMMAND deletes them from the root file system too,
# for a package from another layer.

# Deletes, under $1, Finder's folder view settings (.DS_Store), AppleDouble
# files (._*) and folders' localised-name markers (.localized): files and
# links, never folders. Each one is named in the task's log.
phoenix_remove_macos_files() {
    [ -d "$1" ] || return 0
    find "$1" \( -name '.DS_Store' -o -name '._*' -o -name '.localized' \) ! -type d -print |
    while IFS= read -r f; do
        bbnote "phoenix-no-macos-files: removing $f"
        rm -f "$f"
    done
}

do_install:append() {
    phoenix_remove_macos_files "${D}"
}

phoenix_rootfs_remove_macos_files() {
    phoenix_remove_macos_files "${IMAGE_ROOTFS}"
}

# First, so the image's later steps (phoenix-devpush.bbclass's manifest
# stamp) see the root file system without them.
ROOTFS_POSTPROCESS_COMMAND:prepend = "phoenix_rootfs_remove_macos_files; "
