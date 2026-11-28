#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""A fixed GPS position for webOS Phoenix VMs, as NMEA on 127.0.0.1.

The same feed as the Mac's "Phoenix VM Location" app (VMLocation.swift),
without Core Location: for the image regression suite, a Linux host, or a
Mac whose position should not be used. scripts/vm.sh and scripts/make-utm.sh
connect each VM's virtio GPS port (org.webosphoenix.gps.0) to this port.

    tools/vm-location/nmea-feed.py --fixed 30.2672,-97.7431[,ACCURACY] [--port 45570]

Each second a $GPGGA, then a $GPRMC 300 ms later: nyx's GPS module parses
only the first sentence of each read, and reports GGA's HDOP field as the
accuracy in metres (so that field carries the accuracy, 1 to 99.9).
"""

import argparse
import datetime
import selectors
import socket
import sys
import time


def checksum(body):
    x = 0
    for b in body.encode("ascii"):
        x ^= b
    return "%02X" % x


def sentence(body):
    return "$%s*%s\r\n" % (body, checksum(body))


def coordinate(value, width, positive, negative):
    a = abs(value)
    degrees = int(a)
    minutes = (a - degrees) * 60
    return "%0*d%08.5f" % (width, degrees, minutes), positive if value >= 0 else negative


def nmea(lat, lon, accuracy, when):
    t = when.strftime("%H%M%S.") + "%02d" % (when.microsecond // 10000)
    day = when.strftime("%d%m%y")
    la, ns = coordinate(lat, 2, "N", "S")
    lo, ew = coordinate(lon, 3, "E", "W")
    hdop = "%.1f" % min(99.9, max(1.0, accuracy))
    gga = "GPGGA,%s,%s,%s,%s,%s,1,08,%s,0.0,M,0.0,M,," % (t, la, ns, lo, ew, hdop)
    rmc = "GPRMC,%s,A,%s,%s,%s,%s,0.0,,%s,,,A" % (t, la, ns, lo, ew, day)
    return [sentence(gga), sentence(rmc)]


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--fixed", required=True, help="LAT,LON[,ACCURACY metres]")
    p.add_argument("--port", type=int, default=45570)
    p.add_argument("--verbose", action="store_true")
    a = p.parse_args()
    parts = [float(x) for x in a.fixed.split(",")]
    if len(parts) < 2 or abs(parts[0]) > 90 or abs(parts[1]) > 180:
        p.error("--fixed LAT,LON[,ACCURACY]")
    lat, lon = parts[0], parts[1]
    accuracy = parts[2] if len(parts) > 2 else 10.0

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", a.port))
    server.listen(8)
    server.setblocking(False)
    sel = selectors.DefaultSelector()
    sel.register(server, selectors.EVENT_READ)
    clients = set()
    print("nmea-feed: %.5f,%.5f (%.0f m) on 127.0.0.1:%d" % (lat, lon, accuracy, a.port), file=sys.stderr, flush=True)

    def send(line):
        for c in list(clients):
            try:
                c.sendall(line.encode("ascii"))
            except OSError:
                clients.discard(c)
                sel.unregister(c)
                c.close()

    pending = None
    next_tick = time.monotonic() + 1
    while True:
        now = time.monotonic()
        timeout = min(next_tick, pending[0] if pending else next_tick) - now
        for key, _ in sel.select(max(0, timeout)):
            if key.fileobj is server:
                c, _ = server.accept()
                c.setblocking(False)
                clients.add(c)
                sel.register(c, selectors.EVENT_READ)
                if a.verbose:
                    print("nmea-feed: a VM connected (%d)" % len(clients), file=sys.stderr, flush=True)
            else:
                c = key.fileobj
                try:
                    data = c.recv(4096)
                except OSError:
                    data = b""
                if not data:
                    clients.discard(c)
                    sel.unregister(c)
                    c.close()
        now = time.monotonic()
        if pending and now >= pending[0]:
            send(pending[1])
            pending = None
        if now >= next_tick:
            next_tick += 1
            if clients:
                gga, rmc = nmea(lat, lon, accuracy, datetime.datetime.now(datetime.timezone.utc))
                send(gga)
                pending = (now + 0.3, rmc)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
