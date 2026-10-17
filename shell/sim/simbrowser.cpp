// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simbrowser.h"

#include <QNetworkProxy>
#include <QQuickWebEngineProfile>
#include <QTimer>
#include <QRegularExpression>
#include <QWebEngineClientHints>
#include <QWebEngineCookieStore>
#include <QWebEngineUrlRequestInfo>
#include <QWebEngineUrlRequestInterceptor>
#include <QtWebEngineCore/qtwebenginecoreversion.h>

#include "rootfs.h"
#include <QDialog>
#include <QDialogButtonBox>
#include <QFile>
#include <QFileDialog>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QListWidget>
#include <QMessageBox>
#include <QPushButton>
#include <QVBoxLayout>
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0) && QT_CONFIG(webengine_extensions)
#include <QWebEngineExtensionManager>
#include <QWebEngineExtensionInfo>
#endif

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
    applyUserAgent(m_profile, formFactor(true));
}

void SimBrowser::setAppsProfile(QQuickWebEngineProfile *profile)
{
    m_apps = profile;
    if (m_apps)
        applyUserAgent(m_apps, formFactor(false));
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
        applyUserAgent(m_private, formFactor(true));
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
    refreshUserAgents();
    emit userAgentChanged();
}

void SimBrowser::setIdentity(const QString &mode)
{
    const QString identity = mode == QLatin1String("engine") ? mode : QStringLiteral("compatibility");
    if (identity == m_identity)
        return;
    m_identity = identity;
    refreshUserAgents();
    emit identityChanged();
}

void SimBrowser::setPhone(bool phone)
{
    if (phone == m_phone)
        return;
    m_phone = phone;
    refreshUserAgents();
    emit phoneChanged();
}

QString SimBrowser::httpUserAgent() const
{
    return m_profile->httpUserAgent();
}

void SimBrowser::refreshUserAgents()
{
    applyUserAgent(m_profile, formFactor(true));
    if (m_private)
        applyUserAgent(m_private, formFactor(true));
    if (m_apps)
        applyUserAgent(m_apps, formFactor(false));
}

UserAgent::FormFactor SimBrowser::formFactor(bool browser) const
{
    if (browser && m_uaMode == QLatin1String("desktop"))
        return UserAgent::FormFactor::Desktop;
    return m_phone ? UserAgent::FormFactor::Phone : UserAgent::FormFactor::Tablet;
}

void SimBrowser::applyUserAgent(QQuickWebEngineProfile *p, UserAgent::FormFactor form)
{
    if (!m_nativeAgents.contains(p)) {
        m_nativeAgents.insert(p, p->httpUserAgent());
        connect(p, &QObject::destroyed, this, [this, p]() {
            m_nativeAgents.remove(p);
            m_platformScripts.remove(p);
        });
    }
    if (m_identity == QLatin1String("engine") || qgetenv("PHOENIX_BROWSER_IDENTITY") == "engine") {
        QString identity = m_nativeAgents.value(p);
        identity.remove(QRegularExpression(QStringLiteral(" QtWebEngine/[^ ]+")));
        p->setHttpUserAgent(identity);
        p->clientHints()->resetAll();
        if (m_platformScripts.contains(p)) {
            QObject *scripts = p->property("userScripts").value<QObject *>();
            if (scripts)
                QMetaObject::invokeMethod(scripts, "remove", Q_ARG(QWebEngineScript, m_platformScripts.value(p)));
            m_platformScripts.remove(p);
        }
        return;
    }
    // Pages already open read the new one at once (navigator.userAgent,
    // navigator.userAgentData) and send it from then on; nothing reloads
    // (tools/test-useragent-sim.cjs, the adaptive switch). Their
    // navigator.platform, a page script below, changes as they load again
    // (a phone's and a tablet's are the same).
    const int major = UserAgent::chromeMajor();
    p->setHttpUserAgent(UserAgent::userAgent(major, form));
    const UserAgent::ClientHints h = UserAgent::clientHints(major, form);
    QWebEngineClientHints *hints = p->clientHints();
    hints->setAllClientHintsEnabled(true);
    // The brands: from Qt 6.10 Qt WebEngine makes Sec-CH-UA's list from
    // this one too (the majors), in an order of its own (sorted, then
    // permuted by its Chromium's major), where Chrome's puts the GREASE
    // brand first for an even major; the order means nothing (GREASE is
    // there to vary it). Qt 6.8 and 6.9 keep their Chromium's brands in
    // Sec-CH-UA and navigator.userAgentData.brands (Chromium 122 on Qt
    // 6.8); the rest follows the policy there too.
    QVariantMap versions;
    for (const UserAgent::Brand &b : h.fullVersionList)
        versions.insert(b.name, b.version);
    hints->setFullVersionList(versions);
    hints->setFullVersion(h.fullVersion);
    hints->setPlatform(h.platform);
    hints->setPlatformVersion(h.platformVersion);
    hints->setIsMobile(h.mobile);
    hints->setModel(h.model);
    hints->setArch(h.arch);
    hints->setBitness(h.bitness);
    // Qt WebEngine's version, not Qt's: Homebrew pairs Qt 6.12 with Qt
    // WebEngine 6.11, and Qt WebEngine ships apart from Qt.
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0)
    hints->setFormFactors(h.formFactors);
#endif
    // navigator.platform: no profile setting has it, so a script in every
    // page of the profile (its own collection: the views add theirs). Its
    // class is private; its methods are invokable.
    QObject *scripts = p->property("userScripts").value<QObject *>();
    if (!scripts)
        return;
    QWebEngineScript script;
    script.setName(QStringLiteral("phoenix-platform"));
    script.setSourceCode(UserAgent::platformScript(form));
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(true);
    const auto old = m_platformScripts.constFind(p);
    if (old != m_platformScripts.constEnd() && *old == script)
        return;
    if (old != m_platformScripts.constEnd())
        QMetaObject::invokeMethod(scripts, "remove", Q_ARG(QWebEngineScript, *old));
    QMetaObject::invokeMethod(scripts, "insert", Q_ARG(QWebEngineScript, script));
    m_platformScripts.insert(p, script);
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


bool SimBrowser::extensionsSupported() const
{
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0) && QT_CONFIG(webengine_extensions)
    return true;
#else
    return false;
#endif
}

void SimBrowser::showExtensions()
{
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0) && QT_CONFIG(webengine_extensions)
    if (m_extensionsDialog) {
        m_extensionsDialog->show();
        m_extensionsDialog->raise();
        return;
    }
    auto *manager = m_profile->extensionManager();
    auto *dialog = new QDialog;
    m_extensionsDialog = dialog;
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    connect(this, &QObject::destroyed, dialog, &QWidget::close);
    dialog->setWindowTitle(tr("Browser extensions"));
    dialog->resize(600, 440);
    auto *layout = new QVBoxLayout(dialog);
    auto *notice = new QLabel(tr("Install unpacked Manifest V3 extensions from a folder you trust. Extensions apply only to normal browser pages, never private cards or the Passwords vault. Installed extensions start disabled after restart."));
    notice->setWordWrap(true);
    layout->addWidget(notice);
    auto *list = new QListWidget;
    layout->addWidget(list);
    auto *status = new QLabel;
    status->setTextFormat(Qt::PlainText);
    status->setWordWrap(true);
    layout->addWidget(status);
    const auto refresh = [manager, list]() {
        list->clear();
        for (const auto &extension : manager->extensions()) {
            if (!extension.isInstalled())
                continue;
            auto *item = new QListWidgetItem(extension.name() + (extension.isEnabled() ? QObject::tr(" — enabled") : QObject::tr(" — disabled")), list);
            item->setData(Qt::UserRole, extension.id());
        }
    };
    auto *buttons = new QDialogButtonBox;
    auto *install = buttons->addButton(tr("Install from folder…"), QDialogButtonBox::ActionRole);
    auto *toggle = buttons->addButton(tr("Enable / disable"), QDialogButtonBox::ActionRole);
    auto *remove = buttons->addButton(tr("Remove"), QDialogButtonBox::ActionRole);
    buttons->addButton(QDialogButtonBox::Close);
    layout->addWidget(buttons);
    connect(buttons, &QDialogButtonBox::rejected, dialog, &QDialog::close);
    connect(install, &QPushButton::clicked, dialog, [dialog, manager, status]() {
        const QString folder = QFileDialog::getExistingDirectory(dialog, QObject::tr("Choose extension folder"));
        if (folder.isEmpty())
            return;
        QFile manifest(folder + QStringLiteral("/manifest.json"));
        if (!manifest.open(QIODevice::ReadOnly) || manifest.size() > 131072) {
            status->setText(QObject::tr("The folder must contain a manifest.json smaller than 128 KiB."));
            return;
        }
        const QJsonObject metadata = QJsonDocument::fromJson(manifest.readAll()).object();
        if (metadata.value(QStringLiteral("manifest_version")).toInt() != 3) {
            status->setText(QObject::tr("Only Manifest V3 extensions are supported."));
            return;
        }
        QJsonObject access;
        for (const auto &key : {QStringLiteral("permissions"), QStringLiteral("host_permissions"), QStringLiteral("optional_permissions"), QStringLiteral("optional_host_permissions"), QStringLiteral("content_scripts")})
            access.insert(key, metadata.value(key));
        QMessageBox review(QMessageBox::Question, QObject::tr("Review extension access"),
            QObject::tr("Install %1?\n\nRequested access:\n%2\n\nIt will stay disabled until you enable it.")
                .arg(metadata.value(QStringLiteral("name")).toString(), QString::fromUtf8(QJsonDocument(access).toJson(QJsonDocument::Indented))),
            QMessageBox::Yes | QMessageBox::Cancel, dialog);
        review.setTextFormat(Qt::PlainText);
        review.setDefaultButton(QMessageBox::Cancel);
        if (review.exec() == QMessageBox::Yes)
            manager->installExtension(folder);
    });
    connect(toggle, &QPushButton::clicked, dialog, [dialog, manager, list, refresh]() {
        if (!list->currentItem())
            return;
        for (const auto &extension : manager->extensions()) {
            if (!extension.isInstalled() || extension.id() != list->currentItem()->data(Qt::UserRole).toString())
                continue;
            if (!extension.isEnabled()) {
                QMessageBox review(QMessageBox::Warning, QObject::tr("Enable extension"),
                    QObject::tr("Allow this extension to run on browser pages with the access declared by its manifest? It may read or change website data.\n\n%1").arg(extension.name()),
                    QMessageBox::Yes | QMessageBox::Cancel, dialog);
                review.setTextFormat(Qt::PlainText);
                review.setDefaultButton(QMessageBox::Cancel);
                if (review.exec() != QMessageBox::Yes)
                    return;
            }
            manager->setExtensionEnabled(extension, !extension.isEnabled());
            refresh();
            return;
        }
    });
    connect(remove, &QPushButton::clicked, dialog, [manager, list]() {
        if (!list->currentItem())
            return;
        for (const auto &extension : manager->extensions()) {
            if (extension.isInstalled() && extension.id() == list->currentItem()->data(Qt::UserRole).toString()) {
                manager->uninstallExtension(extension);
                return;
            }
        }
    });
    connect(manager, &QWebEngineExtensionManager::installFinished, dialog, [status, refresh](const QWebEngineExtensionInfo &extension) {
        status->setText(extension.error().isEmpty() ? QObject::tr("Installed, disabled. Review access before enabling.") : extension.error());
        refresh();
    });
    connect(manager, &QWebEngineExtensionManager::uninstallFinished, dialog, [refresh](const QWebEngineExtensionInfo &) { refresh(); });
    refresh();
    dialog->show();
#else
    QMessageBox::information(nullptr, tr("Browser extensions"), tr("This engine does not expose extension support. Qt WebEngine 6.10 or later with extensions enabled is required."));
#endif
}
