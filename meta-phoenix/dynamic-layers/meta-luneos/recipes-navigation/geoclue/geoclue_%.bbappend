# webOS Phoenix: GeoClue is installed (Qt Positioning depends on it at run
# time; qtpositioning's geoclue PACKAGECONFIG adds no build dependency, so
# nothing Qt rebuilds) but never runs, and could not find a position if it
# did:
#
# - It is off. GeoClue answers its clients itself, so neither Settings >
#   Location Services' switch nor the per-app permission
#   (org.webosphoenix.service.location) reached it; webOS's own clients use
#   com.webos.service.location, and so do Qt's (qtlocation-luneos-plugin
#   goes first, its bbappend). Its D-Bus activation and systemd unit are
#   removed, so no client can start it.
# - Every source is disabled in geoclue.conf (Wi-Fi, IP, cells, modem GPS,
#   network NMEA, compass, static).
# - No key: LuneOS's 0001-Use-Google-as-default-and-add-API-key.patch, which
#   writes a Google key into [wifi] url, is dropped, every example URL with a
#   key is removed, and the URLs left name the platform's own service.

SRC_URI:remove = "file://0001-Use-Google-as-default-and-add-API-key.patch"

PHOENIX_API_URL ?= "https://api.webosphoenix.org/"

do_install:append() {
    conf=${D}${sysconfdir}/geoclue/geoclue.conf
    api="${PHOENIX_API_URL}"
    if [ -n "$api" ]; then
        case "$api" in
            */) ;;
            *) api="$api/" ;;
        esac
        url="${api}v1/location/geolocate"
    else
        url="https://api.beacondb.net/v1/geolocate"
    fi
    sed -i -e '/^\[ip\]$/,/^\[/{/^#\{0,1\}url=/d}' \
           -e '/^\[wifi\]$/,/^\[/{/^#\{0,1\}url=/d;/^#\{0,1\}submission-url=/d}' \
           -e "s|^\[ip\]$|[ip]\nurl=$url|" \
           -e "s|^\[wifi\]$|[wifi]\nurl=$url|" \
           -e 's/^enable=true$/enable=false/' $conf
    if grep -q -i -E 'key=|AIza' $conf; then
        bbfatal "geoclue.conf still holds an API key"
    fi
    if grep -q '^enable=true' $conf; then
        bbfatal "geoclue.conf: a source is still enabled"
    fi
    for s in ip wifi 3g cdma modem-gps network-nmea compass static-source; do
        sed -n "/^\[$s\]\$/,/^\[/p" $conf | grep -q '^enable=false$' || bbfatal "geoclue.conf: [$s] is not disabled"
    done
    # Nothing starts it: no D-Bus activation, no systemd unit.
    rm -f ${D}${datadir}/dbus-1/system-services/org.freedesktop.GeoClue2.service
    rm -f ${D}${systemd_system_unitdir}/geoclue.service
}
