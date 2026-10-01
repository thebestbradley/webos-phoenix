#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Find the web app manifests of the sites in catalog/curated-sites.json and
write catalog/curated-pwas.json: each site's manifest URL, name, best icon
and origin, checked live. Run it again to refresh the list; sites whose
manifest is gone are left out (and listed).

    python3 server/marketplace/bin/probe-pwas.py
"""

import html.parser
import json
import os
import sys
import urllib.parse
import urllib.request
import gzip

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Linux; webOS Phoenix) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"


def get(url, limit=2_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,*/*",
                                               "Accept-Language": "en-US,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=20) as res:
        data = res.read(limit)
        if res.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        return res.geturl(), data


# Where sites that add their manifest link with JavaScript usually keep it.
GUESSES = ["/manifest.json", "/manifest.webmanifest", "/site.webmanifest", "/app.webmanifest", "/manifest.webapp.json"]


def find_manifest(final, page, explicit):
    if explicit:
        return [urllib.parse.urljoin(final, explicit)]
    p = Links()
    p.feed(page.decode("utf-8", "replace"))
    if p.manifest:
        return [urllib.parse.urljoin(final, p.manifest)]
    return [urllib.parse.urljoin(final, g) for g in GUESSES]


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.manifest = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and "manifest" in (a.get("rel") or "").lower().split() and a.get("href") and not self.manifest:
            self.manifest = a["href"]


def best_icon(icons, base):
    def size(i):
        s = i.get("sizes") or ""
        if "any" in s:
            return 512
        best = 0
        for p in s.split():
            if "x" in p:
                try:
                    best = max(best, min(int(x) for x in p.lower().split("x")))
                except ValueError:
                    pass
        return best
    ok = [i for i in icons if isinstance(i, dict) and i.get("src") and "any" in (i.get("purpose") or "any").split()
          and not (i.get("type") or "").endswith("svg+xml") and not i["src"].split("?")[0].endswith(".svg")]
    if not ok:
        return None
    ok.sort(key=size)
    pick = next((i for i in ok if size(i) >= 192), ok[-1])
    return urllib.parse.urljoin(base, pick["src"])


def main():
    with open(os.path.join(HERE, "catalog", "curated-sites.json")) as f:
        sites = json.load(f)["sites"]
    out, missing = [], []
    for s in sites:
        try:
            try:
                final, page = get(s["url"])
            except Exception:   # noqa: BLE001 - a page that refuses robots may still serve its manifest
                final, page = s["url"], b""
            m = murl = None
            for candidate in find_manifest(final, page, s.get("manifest")):
                try:
                    _, raw = get(candidate)
                    m = json.loads(raw.decode("utf-8-sig"))
                    murl = candidate
                    break
                except Exception:   # noqa: BLE001
                    continue
            if not isinstance(m, dict):
                raise ValueError("no web app manifest found")
            name = m.get("short_name") or m.get("name")
            if not name:
                raise ValueError("manifest has no name")
            start = urllib.parse.urljoin(murl, m.get("start_url") or ".")
            icon = best_icon(m.get("icons") or [], murl)
            if not icon:
                raise ValueError("manifest has no usable icon")
            entry = dict(s)
            entry.pop("url", None)
            entry.update({"manifest": murl, "origin": "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(start)),
                          "icon": icon, "manifestName": name})
            out.append(entry)
            print("ok   %-22s %s" % (s["title"], murl))
        except Exception as e:   # noqa: BLE001 - report every kind of failure
            missing.append({"title": s["title"], "url": s["url"], "why": str(e)[:120]})
            print("skip %-22s %s" % (s["title"], str(e)[:100]))
    with open(os.path.join(HERE, "catalog", "curated-pwas.json"), "w") as f:
        json.dump({"//": "Written by bin/probe-pwas.py from curated-sites.json; checked live. Edit curated-sites.json, not this.",
                   "apps": out, "notFound": missing}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("%d found, %d not" % (len(out), len(missing)))


if __name__ == "__main__":
    sys.exit(main())
