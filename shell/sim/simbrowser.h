// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page views' web engine settings in phoenix-sim, exposed to QML as
// simBrowser (docs/M6-PLAN.md F4 item 7; docs/APP-RUNTIME.md "The browser
// and enyo.WebView").
//
// On webOS the pages an app showed in an enyo.WebView (the browser's,
// Email's message view, the account sign-in pages) were BrowserServer's,
// with its own cookies, cache and settings, apart from the apps' own pages.
// Here they get a profile of their own too ("phoenix-web"), so the
// browser's settings apply to the web without touching the apps:
//   - profile          the page views' (persistent: cookies and cache kept)
//   - privateProfile() an off-the-record one for the browser's Private
//                      Browsing cards; made when the first private view
//                      asks, dropped (cookies, cache, storage and all) once
//                      the last of its views is gone (trackPrivateView)
//   - contentBlocker   requests a page makes to the hosts on the block list
//                      (runtime/content-blocker/hosts.txt) fail; the page
//                      itself (the address typed) always loads
//   - userAgent        "mobile" (webOS's, the default) or "desktop"
//   - setProxy()       the system's proxy (Settings > Wi-Fi > Proxy):
//                      Chromium takes Qt's application proxy, so it applies
//                      to every page and to the services' requests
//                      (/__phoenix/proxy) as well
// The system preferences behind them (browserContentBlocker,
// browserUserAgent, networkProxy) reach the shell as systemStatus (sim.qml).
#pragma once

#include <QObject>
#include <QPointer>
#include <QVariantMap>

#include "contentfilter.h"

#include <QQuickWebEngineProfile>
class QWebEngineUrlRequestInterceptor;
class Rootfs;
class PictureMaker;

class SimBrowser : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QObject *profile READ profileObject CONSTANT)
    Q_PROPERTY(bool contentBlocker READ contentBlocker WRITE setContentBlocker NOTIFY contentBlockerChanged)
    Q_PROPERTY(QString userAgent READ userAgent WRITE setUserAgent NOTIFY userAgentChanged)
    Q_PROPERTY(int blockedCount READ blockedCount NOTIFY blockedCountChanged)
    Q_PROPERTY(int blockListSize READ blockListSize CONSTANT)
    // A phone's browser (the mobile sites) or a tablet's; the adaptive
    // simulator switches it with the layout (sim.qml).
    Q_PROPERTY(bool phone READ phone WRITE setPhone NOTIFY phoneChanged)
public:
    SimBrowser(Rootfs *rootfs, PictureMaker *snapshots, bool phone, QObject *parent = nullptr);

    QQuickWebEngineProfile *profile() const { return m_profile; }
    QObject *profileObject() const;
    Q_INVOKABLE QObject *privateProfile();
    // A view of the private profile: once all of them are gone, the profile
    // goes with everything it kept.
    Q_INVOKABLE void trackPrivateView(QObject *view);
    Q_INVOKABLE bool hasPrivateProfile() const { return m_private; }

    bool contentBlocker() const { return m_blocking; }
    bool phone() const { return m_phone; }
    void setPhone(bool phone);
    void setContentBlocker(bool on);
    QString userAgent() const { return m_uaMode; }
    void setUserAgent(const QString &mode);
    int blockedCount() const { return m_blocked; }
    int blockListSize() const { return m_filter.size(); }
    // The user agent the views send now.
    Q_INVOKABLE QString httpUserAgent() const;

    // {type: "none" | "http" | "socks", host, port}.
    Q_INVOKABLE void setProxy(const QVariantMap &proxy);
    Q_INVOKABLE QVariantMap proxy() const;

    // The browser's Preferences: Clear Cookies, Clear Cache
    // (com.palm.browserServer clearCookies / clearCache).
    Q_INVOKABLE void clearCookies();
    Q_INVOKABLE void clearCache();

    // For the interceptor: should this request fail?
    bool shouldBlock(const QString &host, const QString &firstPartyHost, bool mainFrame);
    void countBlocked();

signals:
    void contentBlockerChanged();
    void userAgentChanged();
    void phoneChanged();
    void blockedCountChanged();

private:
    QQuickWebEngineProfile *makeProfile(bool persistent);
    void applyUserAgent(QQuickWebEngineProfile *p) const;

    Rootfs *m_rootfs;
    PictureMaker *m_snapshots;
    bool m_phone;
    QQuickWebEngineProfile *m_profile = nullptr;
    QPointer<QQuickWebEngineProfile> m_private;
    int m_privateViews = 0;
    QWebEngineUrlRequestInterceptor *m_interceptor = nullptr;
    ContentFilter m_filter;
    bool m_blocking = false;
    QString m_uaMode = QStringLiteral("mobile");
    QString m_chromiumUa;
    int m_blocked = 0;
};
