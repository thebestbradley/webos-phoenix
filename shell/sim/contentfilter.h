// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The browser's content blocker, without Qt WebEngine (so simnet-test
// checks it): docs/M6-PLAN.md F4 item 7, after the community's Ad Blocker
// browser patch. The user agents are useragent.h's.
//
// The block list is a hosts-style file, one host name a line, "#"
// comments; a request to a listed host or to any of its subdomains is
// blocked (ads.example.com blocks x.ads.example.com, not example.com).
// Phoenix's list is runtime/content-blocker/hosts.txt (Apache-2.0, see
// its header and docs/LEGAL.md). "0.0.0.0 host" lines, as hosts files
// write them, are read too.
#pragma once

#include <QFile>
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

private:
    QSet<QString> m_hosts;
};
