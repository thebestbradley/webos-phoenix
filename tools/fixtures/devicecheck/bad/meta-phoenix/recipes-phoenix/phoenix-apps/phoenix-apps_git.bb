# Fixture: packages /usr/palm only; the apps' service also installs /usr/share/luna-service2.
SUMMARY = "Fixture apps"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://LICENSE;md5=00000000000000000000000000000000"

PHOENIX_SRCREV ?= "${AUTOREV}"
SRC_URI = "git://github.com/thebestbradley/webos-phoenix.git;protocol=https;branch=main"
SRCREV = "${PHOENIX_SRCREV}"
S = "${WORKDIR}/git"

do_compile() {
    cd ${S}/apps && npm ci && npm run build
}

do_install() {
    ${PYTHON} ${S}/tools/install-rootfs.py ${D}
    # An empty folder: /etc/phoenix/example.json under it is still missing.
    install -d ${D}${sysconfdir}/phoenix
}

FILES:${PN} = "${prefix}/palm"
RDEPENDS:${PN} = "nodejs"
