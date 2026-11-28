// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The compatibility user agent policy (SimBrowser can instead restore the
// native engine identity, from Web Preferences). It applies to the
// apps' cards (Phoenix's apps, the original webOS apps, installed web apps
// such as Slack, the Sign In card) and the browser's page views (normal and
// private). What a page is told: the User-Agent header and
// navigator.userAgent, the Sec-CH-UA* client hints and
// navigator.userAgentData. The owner's decision of 15 October 2026
// (docs/DECISIONS.md): the current Chrome version, so sites that gate on
// the version serve their real client instead of "update your browser"
// (Slack's server tells Chrome 136 and older so, by the User-Agent).
//
// The version is Chrome's current stable major, not the engine's own:
// the simulator's Qt WebEngine is an older Chromium (Qt 6.11.3: a Chromium
// 140 base with security patches from a newer one; the device's OSE
// runtime Chromium 120). Sites gate on the version string, and that is
// all the string is for: what the engine can do, pages find out by
// testing for it at run time (feature detection), as they must for any
// browser. A page that relies on a feature only a newer Chromium has gets
// the same answer it would from an older Chrome, a missing feature, not a
// wrong one. The engine's real version is reported where people look:
// the simulator's start-up log line and Settings > Device Info > Web
// engine (osInfo's phoenix_web_engine_* keys, from host.json).
//
// The form of every string is Chrome's own (Chromium's
// components/embedder_support/user_agent_utils.cc: GetUnifiedPlatform,
// BuildUserAgentFromOSAndProduct, GetGreasedUserAgentBrandVersion,
// ShuffleBrandList, GetCpuArchitecture, GetCpuBitness):
//   phone    Chrome on an Android phone: "Mozilla/5.0 (Linux; Android 10; K)
//            AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<M>.0.0.0 Mobile
//            Safari/537.36" (the reduced user agent: the major only, the
//            Android version and model frozen), Sec-CH-UA-Mobile ?1
//   tablet   the same without "Mobile", as Chrome on an Android tablet
//   desktop  the browser's Desktop Site: Chrome on Linux, "Mozilla/5.0
//            (X11; Linux x86_64) ... Chrome/<M>.0.0.0 Safari/537.36"
// No QtWebEngine, webOS or Web0S token: sites read webOS as Palm's 2011
// browser or LG's TVs and turn it away, and some refuse QtWebEngine.
// The brands are Chromium's and a GREASE brand, as Chromium (not Google
// Chrome, which this is not) sends them. navigator.platform agrees too
// (Chromium's GetReducedNavigatorPlatform: "Linux armv81" on Android,
// "Linux x86_64" on Linux), by a script in every page: the engine says its
// computer's ("Linux x86_64", "MacIntel" on a Mac), and sites that see an
// Android user agent on another platform report a conflict.
//
// Which major: computed from the date on Chrome's four-week release
// cadence, anchored at Chrome 155's stable release (6 October 2026), so it
// stays current without a code change. Chrome's calendar sometimes leaves
// an extra week at the turn of the year, so the computed major can run a
// few days ahead of the real stable one (Chrome's early stable is a week
// ahead anyway); a new anchor corrects it. In order:
//   PHOENIX_UA_CHROME_MAJOR   the environment's, a whole number: that major
//   setFeedAnchor()           a major and its stable date from elsewhere
//                             (the hook for the update or catalog feed to
//                             supply the current stable release later; not
//                             wired to a feed yet)
//   the built-in anchor       155 on 2026-10-06
// A clock set before the anchor (one not set yet) reports the anchor's
// major: the version never goes below the one current when it was set.
//
// Without Qt WebEngine (useragent-test checks it); SimBrowser applies it to
// the profiles (simbrowser.cpp).
#pragma once

#include <QDate>
#include <QList>
#include <QString>
#include <QStringList>

namespace UserAgent {

// What the page is shown on: the device's form factor, or the browser's
// Desktop Site.
enum class FormFactor { Phone, Tablet, Desktop };

// A Chrome stable release: its major version and the day it shipped.
struct Anchor
{
    int major = 0;
    QDate stable;
};

// Chrome 155, stable on 6 October 2026.
Anchor builtInAnchor();
// The anchor in use: the feed's when one was given, else the built-in one.
Anchor anchor();
// The hook for a feed (System Updates' or the Marketplace's) to give the
// current stable release later: a later major with its date re-anchors the
// cadence; an invalid one (major 0) goes back to the built-in anchor.
// Pages see it once SimBrowser applies the policy again (its refresh()).
void setFeedAnchor(const Anchor &a);

// Chrome's stable major on that day, on the four-week cadence from the
// anchor; never below the anchor's major.
int chromeMajorOn(const QDate &day, const Anchor &from);
// PHOENIX_UA_CHROME_MAJOR's value: a whole number from 1 to 9999, else 0
// (not set, or not a number).
int majorOverride(const QByteArray &value);
// The major pages are told today: the override, else chromeMajorOn(today).
int chromeMajor();

// The User-Agent header and navigator.userAgent.
QString userAgent(int major, FormFactor form);

struct Brand
{
    QString name;
    QString version;
    bool operator==(const Brand &o) const { return name == o.name && version == o.version; }
};

// The user agent client hints (Sec-CH-UA*, navigator.userAgentData) that
// go with userAgent(major, form).
struct ClientHints
{
    QList<Brand> brands;            // Sec-CH-UA: majors, in Chrome's order
    QList<Brand> fullVersionList;   // Sec-CH-UA-Full-Version-List
    QString fullVersion;            // Sec-CH-UA-Full-Version
    QString platform;               // Sec-CH-UA-Platform: "Android", "Linux"
    QString platformVersion;        // Sec-CH-UA-Platform-Version
    bool mobile = false;            // Sec-CH-UA-Mobile
    QString model;                  // Sec-CH-UA-Model
    QString arch;                   // Sec-CH-UA-Arch
    QString bitness;                // Sec-CH-UA-Bitness
    QStringList formFactors;        // Sec-CH-UA-Form-Factors
};
ClientHints clientHints(int major, FormFactor form);

// navigator.platform as Chrome reports it there, and the script that makes
// a page's say so (at the document's creation, in the page's own world).
QString navigatorPlatform(FormFactor form);
QString platformScript(FormFactor form);

// Chrome's GREASE brand for that major ("Not(A:Brand" / "24" for 155).
Brand greaseBrand(int major, bool fullVersion);
// The Sec-CH-UA header's value for a brand list, as Chrome writes it:
// "Chromium";v="155", "Not(A:Brand";v="24".
QString brandHeader(const QList<Brand> &brands);

} // namespace UserAgent
