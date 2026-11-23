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
# PREBUILT: Microsoft's own Linux builds (x86-64, aarch64; built on glibc
# 2.28, so it runs on scarthgap's), from Microsoft's NuGet package
# Microsoft.ML.OnnxRuntime (one 157 MB package for every platform, signed by
# Microsoft), checked by its SHA-256: the same package tools/get-kitten.py
# fetches for the simulator. The release archives on GitHub
# (microsoft/onnxruntime) have answered 404 since about 17 November 2026;
# the package holds the same libraries. meta-openembedded
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
# The package's LICENSE is the release archives' with CRLF line ends.
LIC_FILES_CHKSUM = "file://LICENSE;md5=6ec46c8a226c1c19f68d1af2644f15a8"

ORT_ARCH = "${@{'x86_64': 'x64', 'aarch64': 'arm64'}.get(d.getVar('TARGET_ARCH'), 'none')}"
# A .nupkg is a zip: fetched as a .zip so do_unpack unzips it.
SRC_URI = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${PV}/microsoft.ml.onnxruntime.${PV}.nupkg;downloadfilename=microsoft.ml.onnxruntime.${PV}.zip;subdir=onnxruntime-${PV}"
SRC_URI[sha256sum] = "30df119bd9164eaa187666d93147448fdd4a9a1a3caf83f1505daf7af2d1c5d2"

COMPATIBLE_HOST = "(x86_64|aarch64).*-linux.*"

S = "${UNPACKDIR}/onnxruntime-${PV}"

do_unpack[depends] += "unzip-native:do_populate_sysroot"
do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${libdir} ${D}${datadir}/doc/onnxruntime
    install -m 0755 ${S}/runtimes/linux-${ORT_ARCH}/native/libonnxruntime.so ${D}${libdir}/libonnxruntime.so.${PV}
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
