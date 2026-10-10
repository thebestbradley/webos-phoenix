# Fixture: no Qt WebEngine on OSE; no qt5compat in RDEPENDS.
SUMMARY = "Fixture shell"
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"
SRC_URI = "file://product.env"
RDEPENDS:${PN} += "luna-surfacemanager-base qtdeclarative-qmlplugins"
