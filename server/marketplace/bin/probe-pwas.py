#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
"""Find the web app manifests of the sites in catalog/curated-sites.json and
write catalog/curated-pwas.json: each site's manifest URL, name, best icon
and origin, checked live. Run it again to refresh the list; sites whose
manifest is gone are left out (and listed). A site whose manifest is good
but whose icons are all broken is listed with an icon the catalog service
makes ("iconGenerated": its initials on its theme colour; Catalog.php
generatedIcon).

    python3 server/marketplace/bin/probe-pwas.py           every site
    python3 server/marketplace/bin/probe-pwas.py ID ...    only these (by id
                                                           or title), the
                                                           others kept
"""

import concurrent.futures
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
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# A phone first (Phoenix's own browser), then desktop Chrome: some sites only
# link their manifest in the desktop page (m.youtube.com has none, for one).
UAS = ["Mozilla/5.0 (Linux; webOS Phoenix) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
       "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"]


def get(url, ua=UAS[0], accept="text/html,application/json,*/*", limit=3_000_000, page=None, dest="document"):
    """GET url as a browser does: a page (dest "document", a navigation), or
    the manifest or image a page (at the URL page, None for another site's)
    loads. Returns (final URL, body, headers)."""
    headers = {"User-Agent": ua, "Accept": accept, "Accept-Language": "en-US,en;q=0.8",
               # gzip, as a browser offers (get() undoes it): Microsoft's front end
               # (outlook.live.com, to-do.office.com) answers 417 Expectation Failed
               # to a request that offers none, as urllib's default does not.
               "Accept-Encoding": "gzip"}
    # The Fetch Metadata a browser sends: Meta (facebook.com, web.whatsapp.com)
    # answers 400 to a page request that is not a navigation.
    if dest == "document":
        headers.update({"Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1"})
    else:
        headers.update({"Sec-Fetch-Dest": dest, "Sec-Fetch-Mode": "cors" if dest == "manifest" else "no-cors",
                        "Sec-Fetch-Site": "same-origin" if page and origin(url) == origin(page) else "cross-site"})
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                final, data, got = res.geturl(), res.read(limit), res.headers
                encoding = got.get("Content-Encoding")
            break
        except urllib.error.HTTPError as e:
            # Too many requests: wait as asked (within reason) and ask again.
            if e.code != 429 or attempt == 4:
                raise
            try:
                wait = min(int(e.headers.get("Retry-After") or 0), 30)
            except ValueError:
                wait = 0
            time.sleep(max(wait, 3 * 2 ** attempt))
        except (OSError, http.client.HTTPException):
            # A reset connection, a cut-off answer or a timeout says nothing about the site:
            # try again rather than leave a site out for a network hiccup. Some
            # hosts reset many handshakes when busy (openlibrary.org about two
            # in five): five tries, waiting longer each time.
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
    if encoding == "gzip" or data[:2] == b"\x1f\x8b":
        try:
            # A stream decompressor, so a page cut at the limit still reads.
            data = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(data)
        except zlib.error as e:
            raise ValueError("not gzip: %s" % e) from e
    return final, data, got


# Where sites that add their manifest link with JavaScript usually keep it:
# next to the page first (web.telegram.org/k/ keeps it in /k/), then at the root.
GUESSES = ["manifest.json", "manifest.webmanifest", "site.webmanifest", "app.webmanifest", "manifest.webapp.json"]
# A manifest's URL written in the page's own script (a <link> added later by
# JavaScript): a quoted path whose file is manifest*.json or *.webmanifest.
IN_SCRIPT = re.compile(r"""["'(]((?:https?:)?[\w./~%-]*?/?(?:manifest[\w.-]*\.json|[\w.-]*\.webmanifest)(?:\?[\w=&.%-]*)?)["')]""")


def bot_check(e):
    """Which bot check refused a request, as its answer says (" (a Cloudflare
    bot check)"), or "": a site behind one cannot be checked from a server or a
    cloud network, only from an ordinary connection (README, "The curated web apps")."""
    h = getattr(e, "headers", None)
    if not isinstance(e, urllib.error.HTTPError) or h is None or e.code not in (401, 403, 429):
        return ""
    if h.get("cf-mitigated"):
        return " (a Cloudflare bot check)"
    if h.get("x-datadome") or "datadome" in (h.get("server") or "").lower():
        return " (a DataDome bot check)"
    if "akamai" in (h.get("server") or "").lower():
        return " (Akamai bot protection)"
    if (h.get("server") or "").lower() == "cloudflare":
        return " (refused by Cloudflare)"
    return ""


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


def usable_icons(icons, base):
    """The manifest's icons the device can use, best first: as the device's
    lib/pwa.js, a picture (not SVG) on the web, for any purpose; the smallest
    of 192 px or more first, then the larger ones, then the smaller ones."""
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
    ok = [i for i in icons if isinstance(i, dict) and isinstance(i.get("src"), str) and "any" in (i.get("purpose") or "any").split()
          and not (i.get("type") or "").endswith("svg+xml") and not i["src"].split("?")[0].endswith(".svg")
          and urllib.parse.urljoin(base, i["src"]).startswith(("https://", "http://"))]
    ok.sort(key=size)
    ok = [i for i in ok if size(i) >= 192] + [i for i in reversed(ok) if size(i) < 192]
    return list(dict.fromkeys(urllib.parse.urljoin(base, i["src"]) for i in ok))


def pick_icon(urls, ua):
    """The first of urls (best first) that shows as a picture in another site's
    page, as the Marketplace shows it: there, and not kept to its own site by
    Cross-Origin-Resource-Policy (claude.ai's, photoshop.adobe.com's). One a
    bot check keeps from the probe counts as there (a device is no robot).
    Failing that, the first that is there at all: the device's install fetches
    it itself, so the launcher icon still works. (None, why) when none is there."""
    own_site, why = None, "manifest's icons are missing"
    for url in urls:
        try:
            _, data, headers = get(url, ua, "image/avif,image/webp,image/png,image/*,*/*;q=0.8", 64_000, dest="image")
        except urllib.error.HTTPError as e:
            if bot_check(e) or e.code in (401, 402, 403, 429):
                return url, None
            why = "manifest's icons are missing (%s: HTTP %d)" % (url, e.code)
            continue
        except Exception as e:   # noqa: BLE001 - not there; try the next one
            why = "manifest's icons are missing (%s: %s)" % (url, e)
            continue
        if not data or data.lstrip()[:1] == b"<":   # an HTML error page answered as 200
            continue
        if (headers.get("Cross-Origin-Resource-Policy") or "").lower() in ("same-origin", "same-site"):
            own_site = own_site or url
            continue
        return url, None
    return own_site, (None if own_site else why)


HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# For a site whose manifest names no colour: one of these, the same each time.
PALETTE = ["#1f6fb2", "#2e7d32", "#c62828", "#6a1b9a", "#ef6c00", "#00838f", "#37474f", "#ad1457"]


def initials(title):
    """The letters of a generated icon: an acronym the title starts with
    ("NYT Games": NYT), else the first letters of its first two words
    ("Ground News": GN, "Formula 1": F1), else its first letter."""
    words = [w for w in re.split(r"[^\w]+", title) if w]
    if not words:
        return "?"
    if 2 <= len(words[0]) <= 3 and words[0].isupper():
        return words[0]
    return "".join(w[0] for w in words[:2]).upper()


def generated_icon(m, title, site, why):
    """What the catalog service draws an icon from, for a manifest whose icons
    are all broken: {text, color, why}. The colour is the manifest's
    theme_color (else its background_color), not white."""
    color = ""
    for key in ("theme_color", "background_color"):
        c = m.get(key)
        if isinstance(c, str) and HEX.match(c.strip()) and c.strip().lower() not in ("#fff", "#ffffff"):
            color = c.strip().lower()
            break
    if len(color) == 4:
        color = "#" + "".join(ch * 2 for ch in color[1:])
    if not color:
        color = PALETTE[zlib.crc32(site.encode()) % len(PALETTE)]
    return {"text": initials(title), "color": color, "why": why[:160]}


def manifest_of(murl, ua, page):
    """The manifest at murl (linked from page), checked: a name and an icon a
    launcher can show. (manifest, name, icon URL, why): with every icon
    broken, icon is None and why says so (the caller generates one)."""
    _, raw, _ = get(murl, ua, "application/manifest+json,application/json,*/*", page=page, dest="manifest")
    m = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(m, dict):
        raise ValueError("not a web app manifest")
    name = m.get("short_name") or m.get("name")
    if not name:
        raise ValueError("manifest has no name")
    icons = usable_icons(m.get("icons") or [], murl)
    if not icons:
        return m, name, None, "manifest has no usable icon"
    icon, why = pick_icon(icons, ua)
    return m, name, icon, why


def probe(s):
    """(entry, None) for a site whose manifest is found, (None, why) otherwise."""
    why = "no web app manifest found"
    tried, unreachable = set(), set()   # unreachable: hosts that did not answer, even when asked again
    fallback = None     # a good manifest whose icons are all broken: listed with a generated icon, if nothing better
    for ua in UAS:
        try:
            final, page, _ = get(s["url"], ua)
        except Exception as e:   # noqa: BLE001 - a page that refuses robots may still serve its manifest
            final, page = s["url"], b""
            why = "the page: %s%s; no web app manifest found" % (e, bot_check(e))
            if isinstance(e, OSError) and not isinstance(e, urllib.error.HTTPError):
                unreachable.add(urllib.parse.urlsplit(s["url"]).netloc)
        for murl, doc in find_manifest(s["url"], final, page, s.get("manifest")):
            host = urllib.parse.urlsplit(murl).netloc
            if murl in tried or host in unreachable:
                continue
            tried.add(murl)
            try:
                m, name, icon, icon_why = manifest_of(murl, ua, doc)
            except urllib.error.HTTPError as e:
                if bot_check(e) and why == "no web app manifest found":
                    why = "%s: %s%s" % (murl, e, bot_check(e))
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
                          "icon": icon or "", "manifestName": name})
            if not icon:
                # Another place may still have a manifest with icons that are there.
                if not fallback:
                    entry["iconGenerated"] = generated_icon(m, s["title"], origin(start), icon_why)
                    fallback = (entry, m.get("display") or "browser")
                continue
            return entry, None, m.get("display") or "browser"
    if fallback:
        return fallback[0], None, fallback[1]
    return None, why, None


def main(only=()):
    with open(os.path.join(HERE, "catalog", "curated-sites.json")) as f:
        sites = json.load(f)["sites"]
    # Only some sites: the others as the last run left them.
    previous = {}
    if only:
        with open(os.path.join(HERE, "catalog", "curated-pwas.json")) as f:
            old = json.load(f)
        previous = {e["title"]: ("ok", e) for e in old.get("apps", [])}
        previous.update({e["title"]: ("skip", e) for e in old.get("notFound", [])})
        unknown = [o for o in only if not any(o in (s["id"], s["title"]) for s in sites)]
        if unknown:
            print("not in curated-sites.json: " + ", ".join(unknown))
            return 1
    wanted = [s for s in sites if not only or s["id"] in only or s["title"] in only]
    out, missing = [], []
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = dict(zip((s["id"] for s in wanted), pool.map(probe, wanted)))
    for s in sites:
        if s["id"] not in results:
            kind, e = previous.get(s["title"], (None, None))
            if kind == "ok":
                out.append(e)
            elif kind == "skip":
                missing.append(e)
            continue
        entry, why, display = results[s["id"]]
        if entry:
            out.append(entry)
            gen = entry.get("iconGenerated")
            print("ok   %-22s %-10s %s%s" % (s["title"], display, entry["manifest"],
                                          " (icon generated: %s; %s)" % (gen["text"], gen["why"]) if gen else ""))
        else:
            missing.append({"title": s["title"], "url": s["url"], "why": why[:160]})
            print("skip %-22s %s" % (s["title"], why[:120]))
    with open(os.path.join(HERE, "catalog", "curated-pwas.json"), "w") as f:
        json.dump({"//": "Written by bin/probe-pwas.py from curated-sites.json; checked live. Edit curated-sites.json, not this.",
                   "apps": out, "notFound": missing}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("%d found, %d not" % (len(out), len(missing)))


if __name__ == "__main__":
    sys.exit(main(tuple(sys.argv[1:])))
