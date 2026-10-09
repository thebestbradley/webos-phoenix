// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simbrowser.h"

#include <QNetworkProxy>
#include <QQuickWebEngineProfile>
#include <QTimer>
#include <QWebEngineCookieStore>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>

#include "rootfs.h"

namespace {

class Interceptor : public QWebEngineUrlRequestInterceptor
{
public:
    explicit Interceptor(SimBrowser *browser) : QWebEngineUrlRequestInterceptor(browser), m_browser(browser) {}

    void interceptRequest(QWebEngineUrlRequestInfo &info) override
    {
        const QUrl url = info.requestUrl();
        if (url.scheme() != QLatin1String("http") && url.scheme() != QLatin1String("https"))
            return;
        const bool mainFrame = info.resourceType() == QWebEngineUrlRequestInfo::ResourceTypeMainFrame;
        if (m_browser->shouldBlock(url.host(), info.firstPartyUrl().host(), mainFrame)) {
            info.block(true);
            m_browser->countBlocked();
        }
    }

private:
    SimBrowser *m_browser;
};

} // namespace

SimBrowser::SimBrowser(Rootfs *rootfs, PictureMaker *snapshots, bool phone, QObject *parent)
    : QObject(parent), m_rootfs(rootfs), m_snapshots(snapshots), m_phone(phone)
{
    m_filter.load(m_rootfs->resolve(QStringLiteral("/usr/share/phoenix/runtime/content-blocker/hosts.txt")));
    m_interceptor = new Interceptor(this);
    m_profile = makeProfile(true);
    m_chromiumUa = m_profile->httpUserAgent();
    applyUserAgent(m_profile);
}

QQuickWebEngineProfile *SimBrowser::makeProfile(bool persistent)
{
    QQuickWebEngineProfile *p;
    if (persistent) {
#if QT_VERSION >= QT_VERSION_CHECK(6, 9, 0)
        p = new QQuickWebEngineProfile(QStringLiteral("phoenix-web"), this);
#else
        p = new QQuickWebEngineProfile(this);
        p->setStorageName(QStringLiteral("phoenix-web"));
        p->setOffTheRecord(false);
#endif
    } else {
        // A profile without storage is off the record: nothing on disk.
        p = new QQuickWebEngineProfile(this);
    }
    // phoenix:// for the pictures and files a page names (Email's message view).
    auto *scheme = new RootfsSchemeHandler(m_rootfs, p);
    scheme->setSnapshots(m_snapshots);
    p->installUrlSchemeHandler(Rootfs::scheme().toLatin1(), scheme);
    p->setUrlRequestInterceptor(m_interceptor);
    return p;
}

QObject *SimBrowser::profileObject() const
{
    return m_profile;
}

QObject *SimBrowser::privateProfile()
{
    if (!m_private) {
        m_private = makeProfile(false);
        applyUserAgent(m_private);
    }
    return m_private;
}

void SimBrowser::trackPrivateView(QObject *view)
{
    if (!view || !m_private)
        return;
    ++m_privateViews;
    QPointer<QQuickWebEngineProfile> profile = m_private;
    connect(view, &QObject::destroyed, this, [this, profile]() {
        if (--m_privateViews > 0 || !profile)
            return;
        // The last private view is gone: its profile goes after it (the
        // view's page lets go of it as the event loop runs), and the next
        // private card starts from nothing.
        if (m_private == profile)
            m_private = nullptr;
        QTimer::singleShot(0, profile, [profile]() {
            if (profile)
                profile->deleteLater();
        });
    });
}

void SimBrowser::setContentBlocker(bool on)
{
    if (on == m_blocking)
        return;
    m_blocking = on;
    emit contentBlockerChanged();
}

void SimBrowser::setUserAgent(const QString &mode)
{
    const QString m = mode == QLatin1String("desktop") ? mode : QStringLiteral("mobile");
    if (m == m_uaMode)
        return;
    m_uaMode = m;
    applyUserAgent(m_profile);
    if (m_private)
        applyUserAgent(m_private);
    emit userAgentChanged();
}

void SimBrowser::setPhone(bool phone)
{
    if (phone == m_phone)
        return;
    m_phone = phone;
    applyUserAgent(m_profile);
    if (m_private)
        applyUserAgent(m_private);
    emit phoneChanged();
}

QString SimBrowser::httpUserAgent() const
{
    return m_profile->httpUserAgent();
}

void SimBrowser::applyUserAgent(QQuickWebEngineProfile *p) const
{
    p->setHttpUserAgent(ContentFilter::userAgent(m_chromiumUa, m_uaMode, m_phone));
}

bool SimBrowser::shouldBlock(const QString &host, const QString &firstPartyHost, bool mainFrame)
{
    // The page asked for, and a site on the list visited on purpose, load.
    return m_blocking && !mainFrame && m_filter.blocks(host) && !m_filter.blocks(firstPartyHost);
}

void SimBrowser::countBlocked()
{
    ++m_blocked;
    emit blockedCountChanged();
}

void SimBrowser::setProxy(const QVariantMap &proxy)
{
    const QString type = proxy.value(QStringLiteral("type")).toString();
    const QString host = proxy.value(QStringLiteral("host")).toString().trimmed();
    const int port = proxy.value(QStringLiteral("port")).toInt();
    if ((type == QLatin1String("http") || type == QLatin1String("socks")) && !host.isEmpty() && port > 0 && port < 65536) {
        QNetworkProxy::setApplicationProxy(QNetworkProxy(type == QLatin1String("http") ? QNetworkProxy::HttpProxy
                                                                                      : QNetworkProxy::Socks5Proxy,
                                                         host, quint16(port)));
    } else {
        // None set: the computer's own (its proxy settings or environment),
        // as before, not "no proxy".
        QNetworkProxy::setApplicationProxy(QNetworkProxy(QNetworkProxy::DefaultProxy));
    }
}

QVariantMap SimBrowser::proxy() const
{
    const QNetworkProxy p = QNetworkProxy::applicationProxy();
    QVariantMap out;
    out[QStringLiteral("type")] = p.type() == QNetworkProxy::HttpProxy ? QStringLiteral("http")
        : p.type() == QNetworkProxy::Socks5Proxy ? QStringLiteral("socks") : QStringLiteral("none");
    out[QStringLiteral("host")] = p.hostName();
    out[QStringLiteral("port")] = int(p.port());
    return out;
}

void SimBrowser::clearCookies()
{
    m_profile->cookieStore()->deleteAllCookies();
}

void SimBrowser::clearCache()
{
    m_profile->clearHttpCache();
}
