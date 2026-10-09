# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# ONNX Runtime's library (libonnxruntime.so.1), what phoenix-tts (the
# Assistant's voice, Kitten TTS; services/tts, installed by phoenix-shell)
# loads at run time (dlopen, its C API version 16 or later). With
# kitten-tts-nano and cmudict; packagegroup-phoenix-assistant installs all
# three where this one exists, and phoenix-tts says when it is missing
# (Speech then speaks with Flite).
#
# PREBUILT: Microsoft's own Linux release (x86-64, aarch64; built on glibc
# 2.28, so it runs on scarthgap's), checked by its SHA-256: the same
# archives tools/get-kitten.py fetches for the simulator. meta-openembedded
# has no onnxruntime recipe (checked 9 October 2026); building it from
# source (CMake, its own copies of protobuf, abseil, Eigen and more, an hour
# or more of compiling) is a recipe of its own, to do: it would give armv7
# devices Kitten too (they speak with Flite) and security updates.
#
# License: MIT (the archive's LICENSE); its ThirdPartyNotices.txt lists the
# libraries built in (Apache-2.0, BSD, MIT and the like) and ships beside it.
# docs/LEGAL.md.

SUMMARY = "ONNX Runtime inference library (libonnxruntime), prebuilt"
HOMEPAGE = "https://onnxruntime.ai"
SECTION = "libs"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=0f7e3b1308cb5c00b372a6e78835732d"

ORT_ARCH = "${@{'x86_64': 'x64', 'aarch64': 'aarch64'}.get(d.getVar('TARGET_ARCH'), 'none')}"
SRC_URI = "https://github.com/microsoft/onnxruntime/releases/download/v${PV}/onnxruntime-linux-${ORT_ARCH}-${PV}.tgz;name=${TARGET_ARCH}"
SRC_URI[x86_64.sha256sum] = "a5ed5a3cac51fbb2e90da632ae43d19212faaa20e76484e62bcb7c23ddb3b3fd"
SRC_URI[aarch64.sha256sum] = "e16a27a8ed330bbc698df7330b0cf56e722f354e3bcc92118682c74ef3c3e3da"

COMPATIBLE_HOST = "(x86_64|aarch64).*-linux.*"

S = "${UNPACKDIR}/onnxruntime-linux-${ORT_ARCH}-${PV}"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${libdir} ${D}${datadir}/doc/onnxruntime
    install -m 0755 ${S}/lib/libonnxruntime.so.${PV} ${D}${libdir}/
    ln -sf libonnxruntime.so.${PV} ${D}${libdir}/libonnxruntime.so.1
    install -m 0644 ${S}/ThirdPartyNotices.txt ${D}${datadir}/doc/onnxruntime/
}

# Loaded by its soname at run time: the runtime package's. Already stripped,
# built elsewhere.
FILES:${PN} = "${libdir}/libonnxruntime.so.* ${datadir}/doc/onnxruntime"
FILES_SOLIBSDEV = ""
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} = "already-stripped ldflags"
