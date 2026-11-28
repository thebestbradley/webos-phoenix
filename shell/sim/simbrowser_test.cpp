// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
#include "simbrowser.h"
#include "rootfs.h"
#include <QApplication>
#include <QDialog>
#include <QDir>
#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>
#include <QtWebEngineQuick>
#include <QTcpServer>
#include <QTcpSocket>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineLoadingInfo>
#include <QWebEngineClientHints>
#include <QtWebEngineCore/qtwebenginecoreversion.h>
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0) && QT_CONFIG(webengine_extensions)
#include <QWebEngineExtensionManager>
#include <QWebEngineExtensionInfo>
#endif

static QStringList fixtureDirectories;

class BrowserTest : public QObject
{
    Q_OBJECT
private slots:
    void identitySwitchesRestoreRealEngineAndCompatibility()
    {
        Rootfs root(QStringLiteral(PHOENIX_REPO_DIR));
        SimBrowser browser(&root, nullptr, false);
        const QString compatibility = browser.httpUserAgent();
        QVERIFY(compatibility.contains(QStringLiteral("Android")));
        browser.setIdentity(QStringLiteral("engine"));
        QVERIFY(browser.httpUserAgent().contains(QStringLiteral("Chrome/") + QString::fromLatin1(qWebEngineChromiumVersion()).section(QLatin1Char('.'), 0, 0) + QLatin1Char('.')));
        QVERIFY(!browser.httpUserAgent().contains(QStringLiteral("QtWebEngine")));
        QVERIFY(browser.profile()->clientHints()->platform() != QStringLiteral("Android"));
        browser.setIdentity(QStringLiteral("compatibility"));
        QCOMPARE(browser.httpUserAgent(), compatibility);
        QCOMPARE(browser.profile()->clientHints()->platform(), QStringLiteral("Android"));
    }

    void httpErrorRetainsResponseDocument()
    {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost));
        connect(&server, &QTcpServer::newConnection, &server, [&server]() {
            auto *socket = server.nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [socket]() {
                socket->readAll();
                const QByteArray body = "<!doctype html><title>Verification required</title><h1>Provider verification response</h1>";
                socket->write("HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                socket->disconnectFromHost();
            });
            connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        });
        QWebEngineProfile profile;
        QWebEnginePage page(&profile);
        QSignalSpy finished(&page, &QWebEnginePage::loadFinished);
        connect(&page, &QWebEnginePage::loadingChanged, &page, [](const QWebEngineLoadingInfo &info) {
            if (info.status() == QWebEngineLoadingInfo::LoadFailedStatus)
                qInfo() << "HTTP response load" << info.errorDomain() << info.errorCode() << "internal error page" << info.isErrorPage();
        });
        page.load(QUrl(QStringLiteral("http://127.0.0.1:%1/").arg(server.serverPort())));
        QTRY_VERIFY_WITH_TIMEOUT(!finished.isEmpty(), 10000);
        QString body;
        page.toPlainText([&body](const QString &value) { body = value; });
        QTRY_VERIFY_WITH_TIMEOUT(body.contains(QStringLiteral("Provider verification response")), 10000);
    }
    void extensionsAreDisabledAndProfileIsolated()
    {
#if QTWEBENGINECORE_VERSION >= QT_VERSION_CHECK(6, 10, 0) && QT_CONFIG(webengine_extensions)
        QTemporaryDir data;
        QVERIFY(data.isValid());
        // Profile preferences finish writing when the engine shuts down.
        data.setAutoRemove(false);
        fixtureDirectories.append(data.path());
        Rootfs root(QStringLiteral(PHOENIX_REPO_DIR));
        SimBrowser browser(&root, nullptr, false);
        browser.profile()->setPersistentStoragePath(data.path() + QStringLiteral("/browser"));
        browser.profile()->setCachePath(data.path() + QStringLiteral("/cache"));
        QQuickWebEngineProfile apps(QStringLiteral("test-apps"));
        apps.setPersistentStoragePath(data.path() + QStringLiteral("/apps"));
        browser.setAppsProfile(&apps);
        auto *manager = browser.profile()->extensionManager();
        QVERIFY(manager);
        const QString extensionPath = data.path() + QStringLiteral("/fixture");
        QVERIFY(QDir().mkpath(extensionPath));
        QFile manifest(extensionPath + QStringLiteral("/manifest.json"));
        QVERIFY(manifest.open(QIODevice::WriteOnly));
        manifest.write(R"({"manifest_version":3,"name":"Phoenix isolation test","version":"1.0"})");
        manifest.close();
        QSignalSpy installed(manager, &QWebEngineExtensionManager::installFinished);
        manager->installExtension(extensionPath);
        QTRY_COMPARE_WITH_TIMEOUT(installed.count(), 1, 10000);
        const auto extension = qvariant_cast<QWebEngineExtensionInfo>(installed.takeFirst().at(0));
        QVERIFY2(extension.error().isEmpty(), qPrintable(extension.error()));
        QVERIFY(extension.isInstalled());
        QVERIFY(!extension.isEnabled());
        for (const auto &other : apps.extensionManager()->extensions())
            QVERIFY(other.id() != extension.id());
        auto *privateProfile = qobject_cast<QQuickWebEngineProfile *>(browser.privateProfile());
        QVERIFY(privateProfile);
        QVERIFY(privateProfile->isOffTheRecord());
        browser.showExtensions();
        QDialog *dialog = nullptr;
        for (auto *widget : QApplication::topLevelWidgets()) {
            if (widget->windowTitle() == QStringLiteral("Browser extensions"))
                dialog = qobject_cast<QDialog *>(widget);
        }
        QVERIFY(dialog);
        QVERIFY(dialog->isVisible());
        QSignalSpy removed(manager, &QWebEngineExtensionManager::uninstallFinished);
        manager->uninstallExtension(extension);
        QTRY_COMPARE_WITH_TIMEOUT(removed.count(), 1, 10000);
        for (const auto &other : manager->extensions())
            QVERIFY(other.id() != extension.id());
        dialog->close();
#else
        QSKIP("Engine does not expose extension management");
#endif
    }
};

int main(int argc, char **argv)
{
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    RootfsSchemeHandler::registerScheme();
    QtWebEngineQuick::initialize();
    int result;
    {
        QApplication app(argc, argv);
        BrowserTest test;
        result = QTest::qExec(&test, argc, argv);
    }
    for (const QString &path : fixtureDirectories)
        QDir(path).removeRecursively();
    return result;
}
#include "simbrowser_test.moc"
