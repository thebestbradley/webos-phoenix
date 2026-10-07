// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The browser's content blocker and user agent, without Qt WebEngine (so
// simnet-test checks them): docs/M6-PLAN.md F4 item 7, after the
// community's Ad Blocker and User Agent Override browser patches.
//
// The block list is a hosts-style file, one host name a line, "#"
// comments; a request to a listed host or to any of its subdomains is
// blocked (ads.example.com blocks x.ads.example.com, not example.com).
// Phoenix's list is runtime/content-blocker/hosts.txt (Apache-2.0, see
// its header and docs/LEGAL.md). "0.0.0.0 host" lines, as hosts files
// write them, are read too.
#pragma once

#include <QFile>
#include <QRegularExpression>
#include <QSet>
#include <QString>
#include <QStringList>

class ContentFilter
{
public:
    bool load(const QString &file)
    {
        QFile f(file);
        if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
            return false;
        QStringList hosts;
        while (!f.atEnd()) {
            QString line = QString::fromUtf8(f.readLine());
            const int hash = line.indexOf(QLatin1Char('#'));
            if (hash >= 0)
                line.truncate(hash);
            const QStringList words = line.simplified().split(QLatin1Char(' '), Qt::SkipEmptyParts);
            if (words.isEmpty())
                continue;
            // "0.0.0.0 ads.example.com" or "ads.example.com".
            hosts << (words.size() > 1 ? words.at(1) : words.at(0));
        }
        setHosts(hosts);
        return true;
    }

    void setHosts(const QStringList &hosts)
    {
        m_hosts.clear();
        for (const QString &h : hosts) {
            const QString host = h.trimmed().toLower();
            if (!host.isEmpty() && host != QLatin1String("localhost"))
                m_hosts.insert(host);
        }
    }

    int size() const { return m_hosts.size(); }

    // The host, or one of the domains it is under, is listed.
    bool blocks(const QString &host) const
    {
        QString h = host.toLower();
        while (!h.isEmpty()) {
            if (m_hosts.contains(h))
                return true;
            const int dot = h.indexOf(QLatin1Char('.'));
            if (dot < 0)
                return false;
            h = h.mid(dot + 1);
        }
        return false;
    }

    // The browser's user agent from Chromium's own (QtWebEngine's default,
    // "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like
    // Gecko) QtWebEngine/6.8.1 Chrome/122.0.0.0 Safari/537.36").
    //   "desktop"  Chromium's own, as a desktop browser sends it.
    //   "mobile"   webOS in place of the platform, as the original's
    //              ("Mozilla/5.0 (webOS/1.4.5; U; en-US) ... Pre/1.0",
    //              "(hp-tablet; Linux; hpwOS/3.0.5; U; en-US) ...
    //              TouchPad/1.0"); a phone adds "Mobile", which sites read
    //              as a phone, a tablet does not (as Chrome on Android).
    //              The QtWebEngine token goes: some sites refuse it.
    static QString userAgent(const QString &chromium, const QString &mode, bool phone)
    {
        if (mode == QLatin1String("desktop"))
            return chromium;
        QString ua = chromium;
        ua.replace(QRegularExpression(QStringLiteral("^Mozilla/5\\.0 \\([^)]*\\)")),
                   phone ? QStringLiteral("Mozilla/5.0 (Linux; webOS/3.0.5; Phoenix)")
                         : QStringLiteral("Mozilla/5.0 (Linux; hpwOS/3.0.5; Phoenix Tablet)"));
        ua.replace(QRegularExpression(QStringLiteral(" QtWebEngine/\\S+")), QString());
        if (phone && !ua.contains(QLatin1String(" Mobile ")))
            ua.replace(QStringLiteral(" Safari/"), QStringLiteral(" Mobile Safari/"));
        return ua;
    }

private:
    QSet<QString> m_hosts;
};
