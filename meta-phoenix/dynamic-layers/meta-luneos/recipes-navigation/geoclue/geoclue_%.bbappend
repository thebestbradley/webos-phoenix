# webOS Phoenix: GeoClue without anyone's API key. LuneOS's
# 0001-Use-Google-as-default-and-add-API-key.patch writes a Google key into
# geoclue.conf's [wifi] url; it is dropped, and GeoClue's Wi-Fi and IP
# lookups go to the platform's own geolocate service (beaconDB when
# PHOENIX_API_URL is empty). Every commented example URL is removed too
# (upstream's list includes a sample key).
#
# webOS's own clients use com.webos.service.location, not GeoClue: it is
# here because Qt Positioning depends on it (qtpositioning's geoclue
# PACKAGECONFIG, a runtime dependency only, so nothing Qt rebuilds).

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
           -e "s|^\[wifi\]$|[wifi]\nurl=$url|" $conf
    if grep -q -i -E 'key=|AIza' $conf; then
        bbfatal "geoclue.conf still holds an API key"
    fi
    [ "$(grep -c "^url=$url$" $conf)" = "2" ] || bbfatal "geoclue.conf: the [ip] and [wifi] urls were not set"
}
