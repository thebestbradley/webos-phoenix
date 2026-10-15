// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// useragent-test: the user agent policy (useragent.h) without a window:
// Chrome's major on the four-week cadence (around the anchor, a year
// ahead, a clock not yet set), the environment's override and the feed's
// anchor, and the user agent and client hints per form factor. The pages'
// side, what a site receives and reads, is tools/test-useragent-sim.cjs's.
//
//   build/useragent-test

#include "useragent.h"

#include <QCoreApplication>
#include <cstdio>

using namespace UserAgent;

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}
static void checkEq(const QString &got, const QString &want, const char *what)
{
    check(got == want, what);
    if (got != want)
        std::printf("       got:  %s\n       want: %s\n", qPrintable(got), qPrintable(want));
}

static void cadence()
{
    const Anchor a = builtInAnchor();
    check(a.major == 155 && a.stable == QDate(2026, 10, 6), "the built-in anchor: Chrome 155, stable on 6 October 2026");
    check(chromeMajorOn(QDate(2026, 10, 6), a) == 155, "the anchor's day: 155");
    check(chromeMajorOn(QDate(2026, 10, 15), a) == 155, "nine days on (15 October 2026): still 155");
    check(chromeMajorOn(QDate(2026, 11, 2), a) == 155, "27 days on: still 155");
    check(chromeMajorOn(QDate(2026, 11, 3), a) == 156, "28 days on (3 November 2026): 156");
    check(chromeMajorOn(QDate(2026, 12, 1), a) == 157, "56 days on: 157");
    check(chromeMajorOn(QDate(2027, 10, 6), a) == 168, "a year on (365 days, 13 releases): 168");
    check(chromeMajorOn(QDate(2027, 10, 15), a) == 168, "a year from 15 October 2026: 168");
    check(chromeMajorOn(QDate(2026, 10, 5), a) == 155, "the day before the anchor: the anchor's major, never lower");
    check(chromeMajorOn(QDate(2000, 1, 1), a) == 155, "a clock not set yet (2000): the anchor's major");
    check(chromeMajorOn(QDate(), a) == 155, "no date: the anchor's major");
}

static void overrides()
{
    check(majorOverride("160") == 160, "PHOENIX_UA_CHROME_MAJOR=160: 160");
    check(majorOverride(" 170\n") == 170, "... spaces around it are fine");
    check(majorOverride("") == 0 && majorOverride("abc") == 0 && majorOverride("155.0") == 0,
          "not a whole number: no override");
    check(majorOverride("0") == 0 && majorOverride("-3") == 0 && majorOverride("10000") == 0, "out of range: no override");

    qputenv("PHOENIX_UA_CHROME_MAJOR", "161");
    check(chromeMajor() == 161, "the environment's major is the one pages are told");
    qputenv("PHOENIX_UA_CHROME_MAJOR", "soon");
    check(chromeMajor() == chromeMajorOn(QDate::currentDate(), builtInAnchor()), "a bad value: today's, computed");
    qunsetenv("PHOENIX_UA_CHROME_MAJOR");
    check(chromeMajor() == chromeMajorOn(QDate::currentDate(), builtInAnchor()), "without it: today's, computed");
    check(chromeMajor() >= 155, "... at least 155");

    // The feed's hook: a later release re-anchors the cadence.
    setFeedAnchor({ 158, QDate(2027, 1, 5) });
    check(anchor().major == 158 && anchor().stable == QDate(2027, 1, 5), "a feed's anchor is the one used");
    check(chromeMajorOn(QDate(2027, 2, 1), anchor()) == 158 && chromeMajorOn(QDate(2027, 2, 2), anchor()) == 159,
          "... and the cadence runs from it");
    setFeedAnchor({});
    check(anchor().major == 155, "an empty one goes back to the built-in anchor");
    setFeedAnchor({ 158, QDate() });
    check(anchor().major == 155, "one without a date is not used");
}

static void userAgents()
{
    checkEq(userAgent(155, FormFactor::Phone),
            QStringLiteral("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36"),
            "phone: Chrome on an Android phone, reduced, Mobile");
    checkEq(userAgent(155, FormFactor::Tablet),
            QStringLiteral("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"),
            "tablet: Chrome on an Android tablet, not Mobile");
    checkEq(userAgent(155, FormFactor::Desktop),
            QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"),
            "desktop (the browser's Desktop Site): Chrome on Linux");
    check(userAgent(168, FormFactor::Phone).contains(QLatin1String(" Chrome/168.0.0.0 ")), "the major given, .0.0.0");
    bool clean = true;
    for (FormFactor f : { FormFactor::Phone, FormFactor::Tablet, FormFactor::Desktop })
        for (const char *token : { "QtWebEngine", "webOS", "Web0S", "hpwOS", "wOSBrowser" })
            clean = clean && !userAgent(155, f).contains(QLatin1String(token), Qt::CaseInsensitive);
    check(clean, "no QtWebEngine, webOS, Web0S or hpwOS token");
    check(navigatorPlatform(FormFactor::Phone) == QLatin1String("Linux armv81")
              && navigatorPlatform(FormFactor::Tablet) == QLatin1String("Linux armv81"),
          "navigator.platform on Android: Linux armv81, as Chrome's");
    check(navigatorPlatform(FormFactor::Desktop) == QLatin1String("Linux x86_64"), "... on Linux: Linux x86_64");
    check(platformScript(FormFactor::Phone).contains(QLatin1String("Navigator.prototype, \"platform\""))
              && platformScript(FormFactor::Phone).contains(QLatin1String("return \"Linux armv81\"")),
          "the page script says the same");
}

static void hints()
{
    // GREASE, against the headers the engines send themselves: Qt
    // WebEngine 6.8.1 (Chromium 122) and 6.11.3 and 6.12.0 (140), and Chrome 120.
    checkEq(brandHeader(clientHints(122, FormFactor::Desktop).brands), QStringLiteral("\"Not(A:Brand\";v=\"24\", \"Chromium\";v=\"122\""),
            "Chromium 122's Sec-CH-UA, as Qt WebEngine 6.8.1 sends it");
    checkEq(brandHeader(clientHints(140, FormFactor::Desktop).brands), QStringLiteral("\"Not=A?Brand\";v=\"24\", \"Chromium\";v=\"140\""),
            "Chromium 140's, as Qt WebEngine 6.11.3 and 6.12.0 send it");
    checkEq(brandHeader(clientHints(120, FormFactor::Desktop).brands), QStringLiteral("\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\""),
            "Chromium 120's, as Chrome 120 sends it (without Google Chrome's brand)");

    const ClientHints phone = clientHints(155, FormFactor::Phone);
    checkEq(brandHeader(phone.brands), QStringLiteral("\"Chromium\";v=\"155\", \"Not(A:Brand\";v=\"24\""), "155: Chromium's brand and a GREASE brand");
    checkEq(brandHeader(phone.fullVersionList), QStringLiteral("\"Chromium\";v=\"155.0.0.0\", \"Not(A:Brand\";v=\"24.0.0.0\""),
            "... the full version list");
    checkEq(phone.fullVersion, QStringLiteral("155.0.0.0"), "... the full version is the user agent's");
    check(phone.platform == QLatin1String("Android") && phone.mobile, "phone: Android, mobile");
    check(phone.arch.isEmpty() && phone.bitness.isEmpty() && phone.model.isEmpty() && phone.platformVersion.isEmpty(),
          "... no architecture, bitness, model or OS version (as Chrome on Android, and nothing of the computer's)");
    check(phone.formFactors == QStringList{ QStringLiteral("Mobile") }, "... form factor Mobile");

    const ClientHints tablet = clientHints(155, FormFactor::Tablet);
    check(tablet.platform == QLatin1String("Android") && !tablet.mobile, "tablet: Android, not mobile");
    check(tablet.formFactors == QStringList{ QStringLiteral("Desktop") }, "... form factor Desktop, as Chrome's by the mobile bit");
    check(tablet.brands == phone.brands, "... the same brands");

    const ClientHints desktop = clientHints(155, FormFactor::Desktop);
    check(desktop.platform == QLatin1String("Linux") && !desktop.mobile, "desktop: Linux, not mobile");
    check(desktop.arch == QLatin1String("x86") && desktop.bitness == QLatin1String("64"), "... x86, 64-bit, as the user agent's x86_64");
    check(desktop.platformVersion.isEmpty(), "... not the computer's own OS version");

    check(greaseBrand(155, false) == Brand{ QStringLiteral("Not(A:Brand"), QStringLiteral("24") }, "GREASE for 155: Not(A:Brand 24");
    check(greaseBrand(156, false) == Brand{ QStringLiteral("Not:A-Brand"), QStringLiteral("8") }, "GREASE for 156: Not:A-Brand 8");
    check(clientHints(156, FormFactor::Phone).brands.first().name == QLatin1String("Not:A-Brand"), "an even major puts GREASE first, as Chrome does");
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    cadence();
    overrides();
    userAgents();
    hints();
    std::printf("%s\n", failures ? "FAILED" : "PASSED");
    return failures ? 1 : 0;
}
