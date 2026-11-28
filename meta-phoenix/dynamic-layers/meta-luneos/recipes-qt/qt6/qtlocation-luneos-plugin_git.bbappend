# webOS Phoenix: Qt Positioning's default source is LuneOS's plugin, which
# asks com.webos.service.location (so Settings > Location Services' switch and
# its handlers apply), never GeoClue's. Both plugins say Priority 1000, and Qt
# picks among equals in no set order; QtWebEngine (the Browser's pages) uses
# the default source. GeoClue is off on the image too (geoclue_%.bbappend).
do_configure:prepend() {
    sed -i -e 's/"Priority": *[0-9]*/"Priority": 1100/' ${S}/src/plugin.json
    grep -q '"Priority": 1100' ${S}/src/plugin.json || bbfatal "qtlocation-luneos-plugin: plugin.json's Priority not found"
}
