# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# RAUC's system configuration and keyring for Phoenix's machines with A/B
# slots (PHOENIX_RAUC = "1" in the machine's .conf; docs/PRE-IMAGE-CHECKLIST.md
# U1-U3):
#
#   - system.conf: files/<MACHINE>/system.conf (the machine override in
#     FILESPATH picks it), the slots, the boot loader and its environment.
#   - the keyring: PHOENIX_RAUC_KEYRING, a PEM file of the CAs whose bundles
#     the image installs. By default the TEST CA (meta-phoenix/files/rauc/test,
#     scripts/rauc-test-keys.sh), whose keys are public: test images only. A
#     release image names the owner's release CA (PLATFORM.md 7.2).
#
# Both in /etc/rauc, where com.palm.update's callers look
# (services/account/deviceinfo.js reads its compatible; phoenix-diag copies
# it) and dev push never overlays (docs/DEV-PUSH.md 4.2); meta-rauc puts
# them in /usr/lib/rauc, which RAUC reads only without /etc/rauc/system.conf.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

PACKAGE_ARCH = "${MACHINE_ARCH}"

PHOENIX_RAUC_KEYRING ??= "${LAYERDIR_meta-phoenix}/files/rauc/test/ca.cert.pem"

do_install:prepend() {
    # meta-rauc's do_install installs ${RAUC_KEYRING_FILE} from the unpack
    # directory and warns while it is its example: put the keyring there.
    if [ ! -s "${PHOENIX_RAUC_KEYRING}" ] || ! grep -q -- '-----BEGIN CERTIFICATE-----' "${PHOENIX_RAUC_KEYRING}"; then
        bbfatal "PHOENIX_RAUC_KEYRING (${PHOENIX_RAUC_KEYRING}) is not a PEM certificate file"
    fi
    install -m 0644 "${PHOENIX_RAUC_KEYRING}" "${UNPACKDIR}/${RAUC_KEYRING_FILE}"
}
do_install[file-checksums] += "${PHOENIX_RAUC_KEYRING}:True"

do_install:append() {
    install -d ${D}${sysconfdir}/rauc
    mv ${D}${nonarch_libdir}/rauc/system.conf ${D}${sysconfdir}/rauc/system.conf
    mv ${D}${nonarch_libdir}/rauc/$(basename ${RAUC_KEYRING_FILE}) ${D}${sysconfdir}/rauc/keyring.pem
    # Nothing else of this recipe's is in /usr/lib: an empty directory left
    # there fails do_package (installed-vs-shipped, Revision 38).
    rmdir ${D}${nonarch_libdir}/rauc
    rmdir --ignore-fail-on-non-empty ${D}${nonarch_libdir}
    # system.conf names the keyring where it now is
    grep -q '^path=/etc/rauc/keyring.pem$' ${D}${sysconfdir}/rauc/system.conf || \
        bbfatal "files/${MACHINE}/system.conf: [keyring] path must be /etc/rauc/keyring.pem"
}

FILES:${PN} += "${sysconfdir}/rauc"
CONFFILES:${PN} += "${sysconfdir}/rauc/system.conf"
