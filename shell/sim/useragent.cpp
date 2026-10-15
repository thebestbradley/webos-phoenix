// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The user agent policy (useragent.h; useragent_test.cpp).

#include "useragent.h"

namespace UserAgent {

namespace {

// Chrome ships a new major every four weeks.
constexpr int cadenceDays = 28;

Anchor &feedAnchor()
{
    static Anchor a;
    return a;
}

} // namespace

Anchor builtInAnchor()
{
    // Chrome 155.0.8059.x, stable on Tuesday 6 October 2026.
    return { 155, QDate(2026, 10, 6) };
}

Anchor anchor()
{
    const Anchor &feed = feedAnchor();
    return feed.major > 0 && feed.stable.isValid() ? feed : builtInAnchor();
}

void setFeedAnchor(const Anchor &a)
{
    feedAnchor() = a.major > 0 && a.stable.isValid() ? a : Anchor();
}

int chromeMajorOn(const QDate &day, const Anchor &from)
{
    if (!day.isValid() || !from.stable.isValid() || day <= from.stable)
        return from.major;
    return from.major + int(from.stable.daysTo(day) / cadenceDays);
}

int majorOverride(const QByteArray &value)
{
    bool ok = false;
    const int major = value.trimmed().toInt(&ok);
    return ok && major >= 1 && major <= 9999 ? major : 0;
}

int chromeMajor()
{
    const int forced = majorOverride(qgetenv("PHOENIX_UA_CHROME_MAJOR"));
    return forced ? forced : chromeMajorOn(QDate::currentDate(), anchor());
}

QString userAgent(int major, FormFactor form)
{
    // GetUnifiedPlatform: Android's frozen "Linux; Android 10; K"; Linux's
    // "X11; Linux x86_64" whatever the computer.
    const QString platform = form == FormFactor::Desktop ? QStringLiteral("X11; Linux x86_64")
                                                         : QStringLiteral("Linux; Android 10; K");
    // BuildUserAgentFromOSAndProduct with the reduced version: "Mobile " on
    // a phone only (a tablet's Chrome leaves it out, and sites then serve
    // the tablet or full site).
    return QStringLiteral("Mozilla/5.0 (%1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%2.0.0.0 %3Safari/537.36")
        .arg(platform)
        .arg(major)
        .arg(form == FormFactor::Phone ? QStringLiteral("Mobile ") : QString());
}

Brand greaseBrand(int major, bool fullVersion)
{
    // GetGreasedUserAgentBrandVersion, seeded by the major version
    // (https://wicg.github.io/ua-client-hints/#create-arbitrary-brands-section).
    static const char *const chars[] = { " ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_" };
    static const char *const versions[] = { "8", "99", "24" };
    const int seed = qMax(0, major);
    const QString name = QStringLiteral("Not%1A%2Brand").arg(QLatin1String(chars[seed % 11]), QLatin1String(chars[(seed + 1) % 11]));
    const QString version = QLatin1String(versions[seed % 3]);
    return { name, fullVersion ? version + QStringLiteral(".0.0.0") : version };
}

static QList<Brand> brandList(int major, bool fullVersion)
{
    // ShuffleBrandList for two brands: the GREASE brand at seed % 2,
    // Chromium at (seed + 1) % 2.
    const Brand grease = greaseBrand(major, fullVersion);
    const Brand chromium{ QStringLiteral("Chromium"), fullVersion ? QStringLiteral("%1.0.0.0").arg(major) : QString::number(major) };
    return major % 2 == 0 ? QList<Brand>{ grease, chromium } : QList<Brand>{ chromium, grease };
}

ClientHints clientHints(int major, FormFactor form)
{
    ClientHints h;
    h.brands = brandList(major, false);
    h.fullVersionList = brandList(major, true);
    // The reduced user agent's version: the build number is not known here.
    h.fullVersion = QStringLiteral("%1.0.0.0").arg(major);
    h.mobile = form == FormFactor::Phone;
    if (form == FormFactor::Desktop) {
        h.platform = QStringLiteral("Linux");
        // GetCpuArchitecture and GetCpuBitness for the "Linux x86_64" the
        // user agent names (on any computer, a Mac included).
        h.arch = QStringLiteral("x86");
        h.bitness = QStringLiteral("64");
    } else {
        // Chrome on Android leaves the architecture and bitness empty.
        h.platform = QStringLiteral("Android");
    }
    // Chrome sends the real OS version here; the user agent's "Android 10"
    // is frozen, not a version, and the computer's own (its kernel or
    // macOS) is not the device's: left empty, as Chrome leaves what it
    // does not know. The model too ("K" in the user agent).
    h.platformVersion = QString();
    h.model = QString();
    // GetFormFactorsClientHint: "Mobile" or "Desktop" by the mobile bit.
    h.formFactors = { h.mobile ? QStringLiteral("Mobile") : QStringLiteral("Desktop") };
    return h;
}

QString navigatorPlatform(FormFactor form)
{
    // Chromium's GetReducedNavigatorPlatform (navigator_base.cc).
    return form == FormFactor::Desktop ? QStringLiteral("Linux x86_64") : QStringLiteral("Linux armv81");
}

QString platformScript(FormFactor form)
{
    // Navigator.prototype's own accessor, replaced: workers keep the
    // engine's (no page script runs there).
    return QStringLiteral("(function () { try { Object.defineProperty(Navigator.prototype, \"platform\", "
                          "{ get: function () { return \"%1\"; }, configurable: true, enumerable: true }); } catch (e) { } })();")
        .arg(navigatorPlatform(form));
}

QString brandHeader(const QList<Brand> &brands)
{
    QStringList parts;
    for (const Brand &b : brands)
        parts << QStringLiteral("\"%1\";v=\"%2\"").arg(b.name, b.version);
    return parts.join(QStringLiteral(", "));
}

} // namespace UserAgent
