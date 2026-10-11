# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Delta Chat's core as a program: deltachat-rpc-server, JSON-RPC on its
# standard input and output. The Delta Chat account
# (apps/connectors/deltachat, a connector package) starts it as a system
# helper (the connector kit's device.ts, HELPERS: /usr/bin/deltachat-rpc-server,
# DC_ACCOUNTS_PATH in /var/lib/phoenix/connector-data/<service>/), and
# without it says "not available in this build".
#
# License: MPL-2.0 (chatmail/core's LICENSE), weak copyleft, file by file:
# not one of the permissive licences docs/LEGAL.md allows Phoenix's own
# recipes, so the image installs it only when the owner decides it may
# (docs/OPEN-QUESTIONS.md Q89; packagegroup-phoenix-connectors,
# PHOENIX_DELTACHAT = "1"). A separate program, run, not linked: Phoenix's
# code stays Apache-2.0; the core's files are shipped unmodified. MPL-2.0
# 3.2: an image with it says where the source is and offers it (this
# recipe's HOMEPAGE and version; OE's archiver adds it to deploy/sources,
# docs/LEGAL.md "Source offer").
#
# Upstream's own release builds, as its npm packages carry them
# (@deltachat/stdio-rpc-server-linux-<arch>, the binary as package/
# deltachat-rpc-server; each checked against the registry's sha512 integrity).
# About 21 MB on arm64, 20 MB on armv7, 27 MB on x86-64: one binary, the
# core's crypto, mail and SQLite (SQLCipher) inside it. Building it here
# instead (meta-rust's cargo class with the crates listed by
# cargo-update-recipe-crates) is the way to a smaller, size-optimised
# binary, still to do (docs/OPEN-QUESTIONS.md).

SUMMARY = "Delta Chat core JSON-RPC server (deltachat-rpc-server)"
HOMEPAGE = "https://github.com/chatmail/core/tree/v${PV}/deltachat-rpc-server"
SECTION = "net"
LICENSE = "MPL-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MPL-2.0;md5=815ca599c9df247a0c7f619bab123dad"

NPM_ARCH = ""
NPM_ARCH:aarch64 = "arm64"
NPM_ARCH:arm = "arm"
NPM_ARCH:x86-64 = "x64"

SRC_URI = "https://registry.npmjs.org/@deltachat/stdio-rpc-server-linux-${NPM_ARCH}/-/stdio-rpc-server-linux-${NPM_ARCH}-${PV}.tgz;name=${NPM_ARCH};subdir=${BP}"
SRC_URI[arm64.sha256sum] = "efec5c484b6ef28a3fa72a30485af6e31446703fb55f1be53ddf32012d7bce2e"
SRC_URI[arm.sha256sum] = "f37446b104befd232e013bfba7ecc56198d15b4d332915b5c2dd1d4ef22a187e"
SRC_URI[x64.sha256sum] = "b3758104f9d3b55a985f5d2e056fb6490b424196514c06fbb9cf192cd3b8aaf2"

COMPATIBLE_HOST = "(aarch64|arm|x86_64).*-linux.*"

S = "${WORKDIR}/${BP}/package"

do_configure[noexec] = "1"
do_compile[noexec] = "1"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${S}/deltachat-rpc-server ${D}${bindir}/deltachat-rpc-server
}

# Built upstream: no debug symbols to split, its own link flags.
INSANE_SKIP:${PN} += "already-stripped ldflags"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
