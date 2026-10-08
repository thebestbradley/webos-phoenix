#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Find the web app manifests of the sites in catalog/curated-sites.json and
write catalog/curated-pwas.json: each site's manifest URL, name, best icon
and origin, checked live. Run it again to refresh the list; sites whose
manifest is gone are left out (and listed).

    python3 server/marketplace/bin/probe-pwas.py
"""

import concurrent.futures
import gzip
import html.parser
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# A phone first (Phoenix's own browser), then desktop Chrome: some sites only
# link their manifest in the desktop page (m.youtube.com has none, for one).
UAS = ["Mozilla/5.0 (Linux; webOS Phoenix) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
       "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"]


def get(url, ua=UAS[0], accept="text/html,application/json,*/*", limit=3_000_000):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.8"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                final, data, encoding = res.geturl(), res.read(limit), res.headers.get("Content-Encoding")
            break
        except urllib.error.HTTPError:
            raise
        except (OSError, http.client.HTTPException):
            # A reset connection, a cut-off answer or a timeout says nothing about the site:
            # try again rather than leave a site out for a network hiccup.
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    if encoding == "gzip" or data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except (OSError, EOFError) as e:
            raise ValueError("not gzip: %s" % e) from e
    return final, data


# Where sites that add their manifest link with JavaScript usually keep it:
# next to the page first (web.telegram.org/k/ keeps it in /k/), then at the root.
GUESSES = ["manifest.json", "manifest.webmanifest", "site.webmanifest", "app.webmanifest", "manifest.webapp.json"]
# A manifest's URL written in the page's own script (a <link> added later by
# JavaScript): a quoted path whose file is manifest*.json or *.webmanifest.
IN_SCRIPT = re.compile(r"""["'(]((?:https?:)?[\w./~%-]*?/?(?:manifest[\w.-]*\.json|[\w.-]*\.webmanifest)(?:\?[\w=&.%-]*)?)["')]""")


def find_manifest(asked, final, page, explicit):
    """Every place the site's manifest may be, most likely first, each with the
    page it belongs to: (manifest URL, page URL)."""
    if explicit:
        return [(urllib.parse.urljoin(final, explicit), final)]
    text = page.decode("utf-8", "replace")
    p = Links()
    try:
        p.feed(text)
    except Exception:   # noqa: BLE001 - a broken page may still name its manifest
        pass
    out = []
    if p.manifest:
        out.append((urllib.parse.urljoin(final, p.manifest), final))
    out += [(urllib.parse.urljoin(final, m.replace("\\/", "/")), final) for m in IN_SCRIPT.findall(text)
            if "buildmanifest" not in m.lower() and "middlewaremanifest" not in m.lower()]
    # Guesses: next to the page, then at its root; and, for a page that
    # redirected (to a sign-in page, say), the same next to the URL asked for
    # (mail.google.com/mail/ keeps /mail/manifest.json).
    for base in dict.fromkeys([final, asked]):
        out += [(urllib.parse.urljoin(base, g), base) for g in GUESSES]
        out += [(urllib.parse.urljoin(base, "/" + g), base) for g in GUESSES]
    seen, unique = set(), []
    for murl, doc in out:
        if murl not in seen:
            seen.add(murl)
            unique.append((murl, doc))
    return unique


def origin(url):
    return "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(url))


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
    # As the device's lib/pwa.js: a picture (not SVG) on the web, for any purpose.
    ok = [i for i in icons if isinstance(i, dict) and isinstance(i.get("src"), str) and "any" in (i.get("purpose") or "any").split()
          and not (i.get("type") or "").endswith("svg+xml") and not i["src"].split("?")[0].endswith(".svg")
          and urllib.parse.urljoin(base, i["src"]).startswith(("https://", "http://"))]
    if not ok:
        return None
    ok.sort(key=size)
    pick = next((i for i in ok if size(i) >= 192), ok[-1])
    return urllib.parse.urljoin(base, pick["src"])


def manifest_of(murl, ua):
    """The manifest at murl, checked: a name and an icon a launcher can show."""
    _, raw = get(murl, ua, "application/manifest+json,application/json,*/*")
    m = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(m, dict):
        raise ValueError("not a web app manifest")
    name = m.get("short_name") or m.get("name")
    if not name:
        raise ValueError("manifest has no name")
    icon = best_icon(m.get("icons") or [], murl)
    if not icon:
        raise ValueError("manifest has no usable icon")
    return m, name, icon


def probe(s):
    """(entry, None) for a site whose manifest is found, (None, why) otherwise."""
    why = "no web app manifest found"
    tried, unreachable = set(), set()   # unreachable: hosts that did not answer, even when asked again
    for ua in UAS:
        try:
            final, page = get(s["url"], ua)
        except Exception as e:   # noqa: BLE001 - a page that refuses robots may still serve its manifest
            final, page = s["url"], b""
            why = "the page: %s; no web app manifest found" % e
            if isinstance(e, OSError) and not isinstance(e, urllib.error.HTTPError):
                unreachable.add(urllib.parse.urlsplit(s["url"]).netloc)
        for murl, doc in find_manifest(s["url"], final, page, s.get("manifest")):
            host = urllib.parse.urlsplit(murl).netloc
            if murl in tried or host in unreachable:
                continue
            tried.add(murl)
            try:
                m, name, icon = manifest_of(murl, ua)
            except urllib.error.HTTPError:
                continue
            except ValueError as e:
                if "manifest" in str(e) and not isinstance(e, json.JSONDecodeError):
                    why = str(e)
                continue
            except OSError as e:
                unreachable.add(host)
                why = "%s did not answer: %s" % (host, e)
                continue
            except Exception:   # noqa: BLE001 - not there (a broken answer, say); try the next place
                continue
            # A start_url on another origin than the page is ignored and the
            # page itself is the start (the Web App Manifest spec, "processing
            # the start_url member"); a manifest kept on a CDN is relative to it.
            start = urllib.parse.urljoin(murl, m.get("start_url") or ".")
            if origin(start) != origin(doc):
                start = doc
            entry = dict(s)
            entry.pop("url", None)
            entry.update({"manifest": murl, "origin": origin(start),
                          "icon": icon, "manifestName": name})
            return entry, None, m.get("display") or "browser"
    return None, why, None


def main():
    with open(os.path.join(HERE, "catalog", "curated-sites.json")) as f:
        sites = json.load(f)["sites"]
    out, missing = [], []
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for s, (entry, why, display) in zip(sites, pool.map(probe, sites)):
            if entry:
                out.append(entry)
                print("ok   %-22s %-10s %s" % (s["title"], display, entry["manifest"]))
            else:
                missing.append({"title": s["title"], "url": s["url"], "why": why[:160]})
                print("skip %-22s %s" % (s["title"], why[:120]))
    with open(os.path.join(HERE, "catalog", "curated-pwas.json"), "w") as f:
        json.dump({"//": "Written by bin/probe-pwas.py from curated-sites.json; checked live. Edit curated-sites.json, not this.",
                   "apps": out, "notFound": missing}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("%d found, %d not" % (len(out), len(missing)))


if __name__ == "__main__":
    sys.exit(main())
