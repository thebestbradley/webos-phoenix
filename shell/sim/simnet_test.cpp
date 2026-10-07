// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simnet-test: phoenix-sim's network pieces without a window: the
// browser's content blocker list and user agents (contentfilter.h).
//
//   build/simnet-test

#include "contentfilter.h"

#include <QCoreApplication>
#include <QTemporaryFile>
#include <cstdio>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

static void contentFilter()
{
    ContentFilter f;
    check(f.load(QStringLiteral(PHOENIX_REPO_DIR "/runtime/content-blocker/hosts.txt")), "Phoenix's block list loads");
    check(f.size() > 50, "... with its hosts");
    check(f.blocks(QStringLiteral("doubleclick.net")), "a listed host is blocked");
    check(f.blocks(QStringLiteral("ads.g.doubleclick.net")), "... and the hosts under it");
    check(f.blocks(QStringLiteral("WWW.Google-Analytics.com")), "... whatever the case");
    check(!f.blocks(QStringLiteral("google.com")), "a domain above a listed host is not");
    check(!f.blocks(QStringLiteral("notdoubleclick.net")), "nor a name that only ends the same");
    check(!f.blocks(QStringLiteral("webosphoenix.org")), "an unlisted site loads");
    check(!f.blocks(QString()), "nothing for no host");

    QTemporaryFile hosts;
    hosts.open();
    hosts.write("# a comment\n0.0.0.0 tracker.example # after\n\nads.example.org\n127.0.0.1 localhost\n");
    hosts.flush();
    ContentFilter g;
    check(g.load(hosts.fileName()) && g.size() == 2, "a hosts file's lines and comments are read; localhost is not blocked");
    check(g.blocks(QStringLiteral("x.tracker.example")) && g.blocks(QStringLiteral("ads.example.org")), "... both forms");
    check(!g.load(QStringLiteral("/nonexistent/hosts.txt")), "a missing list fails to load");
}

static void userAgents()
{
    const QString chromium = QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                                            "QtWebEngine/6.8.1 Chrome/122.0.6261.171 Safari/537.36");
    check(ContentFilter::userAgent(chromium, QStringLiteral("desktop"), true) == chromium, "desktop: Chromium's own");
    const QString phone = ContentFilter::userAgent(chromium, QStringLiteral("mobile"), true);
    check(phone == QStringLiteral("Mozilla/5.0 (Linux; webOS/3.0.5; Phoenix) AppleWebKit/537.36 (KHTML, like Gecko) "
                                  "Chrome/122.0.6261.171 Mobile Safari/537.36"), "phone: webOS, Mobile, no QtWebEngine token");
    const QString tablet = ContentFilter::userAgent(chromium, QStringLiteral("mobile"), false);
    check(tablet.startsWith(QStringLiteral("Mozilla/5.0 (Linux; hpwOS/3.0.5; Phoenix Tablet)")) && !tablet.contains(QLatin1String("Mobile"))
              && tablet.endsWith(QLatin1String("Chrome/122.0.6261.171 Safari/537.36")), "tablet: hpwOS, not Mobile");
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    contentFilter();
    userAgents();
    std::printf("%s\n", failures ? "FAILED" : "PASSED");
    return failures ? 1 : 0;
}
