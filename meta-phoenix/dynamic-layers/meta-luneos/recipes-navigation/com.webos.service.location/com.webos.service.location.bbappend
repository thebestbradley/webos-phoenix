# webOS Phoenix: where the location service's network positions and place
# names come from, without a third-party key (docs/MAPS.md, "Where the
# position comes from").
#
# - The patch: the platform's own geolocate service as the default network
#   server, an IP-address position when there are no Wi-Fi or cell radios
#   (a VM, a tablet on a wired network), a position the user sets
#   ("manual"), a hybrid request that goes on with the network handler when
#   the GPS source cannot start, and geocoding against a server that takes
#   no signed Google URL.
# - /etc/location/geolocate.conf: that service, from PHOENIX_API_URL (the
#   same platform address servers.json gets, phoenix-apps_git.bb).
# - /etc/location/wsp.conf: replaced. LuneOS's (from the location sources)
#   carries LG's Google Maps key; ours points geocoding at the platform's
#   /v1/location/geocode/json and has no key ("none" in base64: the file
#   format requires the field, and a non-Google URL is sent without it).
#   With PHOENIX_API_URL empty there is no geocoding service.

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://0001-Network-position-without-radios-or-a-third-party-key.patch"

PHOENIX_API_URL ?= "https://api.webosphoenix.org/"

do_install:append() {
    api="${PHOENIX_API_URL}"
    rm -f ${D}${sysconfdir}/location/geolocate.conf
    if [ -n "$api" ]; then
        case "$api" in
            */) ;;
            *) api="$api/" ;;
        esac
        printf '[geolocate]\nurl=%sv1/location/geolocate\n' "$api" > ${D}${sysconfdir}/location/geolocate.conf
        printf '{\n    "wpsName": "phoenix",\n    "apiKey": "bm9uZQ==",\n    "services": [\n        {\n            "features": ["geocode", "reverseGeocode"],\n            "url": "%sv1/location/geocode/json?"\n        }\n    ]\n}\n' "$api" > ${D}${sysconfdir}/location/wsp.conf
    else
        printf '{\n    "wpsName": "none",\n    "apiKey": "bm9uZQ==",\n    "services": []\n}\n' > ${D}${sysconfdir}/location/wsp.conf
    fi
    chmod 0644 ${D}${sysconfdir}/location/wsp.conf
    if grep -q -i -E 'AIza|googleapis' ${D}${sysconfdir}/location/wsp.conf; then
        bbfatal "wsp.conf still names Google"
    fi
}

FILES:${PN} += "${sysconfdir}/location/geolocate.conf"
