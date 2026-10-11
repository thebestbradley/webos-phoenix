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
# License: MPL-2.0 (chatmail/core's LICENSE). A separate program, run, not
# linked: Phoenix's code stays Apache-2.0; the core's files are shipped
# unmodified. MPL-2.0 3.2: the image says where the source is (this
# recipe's HOMEPAGE and version; Yocto's archiver can add the tag's
# source to the release's sources).
#
# Upstream's own release builds, as its npm packages carry them
# (@deltachat/stdio-rpc-server-linux-<arch>, the binary as package/
# deltachat-rpc-server; checksums are the registry's sha512 integrity).
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
SRC_URI[arm64.sha512sum] = "2365ec5b381916b478dfecaec6c551afc191fa00e112de5ad65881d66d37f397859e1df01548837b25f6654ffbd3fed754709920539693245bc666baf5210271"
SRC_URI[arm.sha512sum] = "f1bdb3a9440b38ee630808fdb43b0713d37c98d1924c0e68695947451cf9d1f7622c12e734dd6356b288251c3112070d4998e74cb274d33d44906377ec6c1ec3"
SRC_URI[x64.sha512sum] = "0339d6e05197e1dc4f3f04fffe45218e4cc25a608e19322738a904d108f4a586990453b6622e69775513b5da7a6c5cc4dfa1920a6d3435408b4957a081207db2"

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
