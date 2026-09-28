// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim: runs the Phoenix shell in a desktop window with mock apps.
//
//   phoenix-sim [--size WxH] [--scale N] [--tablet|--phone] [--scene NAME]
//               [--orientation up|left|down|right] [--turn ORIENTATION]
//               [--screenshot FILE [--delay MS]]
//
// Keys: Esc = back gesture, Home/F1 = up gesture, F2 = demo notification,
//       F3 = lock/unlock, F4 = incoming call, F5 = incoming text message,
//       F6 = low battery, F7 = charger in/out, Ctrl+Left / Ctrl+Right =
//       turn the device a quarter turn counter-clockwise / clockwise.
//       Type in card view for Just Type.

#include <QCommandLineParser>
#include <QDir>
#include <QGuiApplication>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickView>
#include <QTimer>

#include "rootfs.h"
#include "simsettings.h"

#ifdef PHOENIX_HAVE_WEBENGINE
#include <QQuickWebEngineProfile>
#include <QtWebEngineQuick>
#endif

#ifndef PHOENIX_QML_DIR
#define PHOENIX_QML_DIR ""
#endif
#ifndef PHOENIX_QML_BUILD_DIR
#define PHOENIX_QML_BUILD_DIR ""
#endif
#ifndef PHOENIX_REPO_DIR
#define PHOENIX_REPO_DIR ""
#endif

int main(int argc, char *argv[])
{
#ifdef PHOENIX_HAVE_WEBENGINE
    // Both must happen before the application object exists.
    RootfsSchemeHandler::registerScheme();
    QtWebEngineQuick::initialize();
#endif
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("phoenix-sim"));
    app.setOrganizationName(QStringLiteral("webos-phoenix"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("webOS Phoenix shell simulator"));
    parser.addHelpOption();
    QCommandLineOption sizeOpt(QStringLiteral("size"), QStringLiteral("Window size in pixels (default 320x480, tablet 1024x768)."), QStringLiteral("WxH"));
    QCommandLineOption scaleOpt(QStringLiteral("scale"), QStringLiteral("Device pixels per legacy pixel, like a denser screen (default 1; the Pre 3 was 1.5 at 480x800)."), QStringLiteral("N"), QStringLiteral("1"));
    QCommandLineOption tabletOpt(QStringLiteral("tablet"), QStringLiteral("Use the tablet (TouchPad) layout."));
    QCommandLineOption phoneOpt(QStringLiteral("phone"), QStringLiteral("Force the phone layout."));
    QCommandLineOption sceneOpt(QStringLiteral("scene"), QStringLiteral("Demo scene: locked, cards, stacks, reorder, maximized, heldcard, launcher, launcheredit, pin, lowbattery, banner, notified, dashboard, justtype, systemmenu, empty."), QStringLiteral("name"));
    QCommandLineOption shotOpt(QStringLiteral("screenshot"), QStringLiteral("Save a screenshot to FILE and exit."), QStringLiteral("file"));
    QCommandLineOption delayOpt(QStringLiteral("delay"), QStringLiteral("Delay before the screenshot (default 1500 ms)."), QStringLiteral("ms"), QStringLiteral("1500"));
    QCommandLineOption qmlOpt(QStringLiteral("qml-dir"), QStringLiteral("Directory containing sim.qml and the Phoenix modules."), QStringLiteral("dir"));
    QCommandLineOption repoOpt(QStringLiteral("repo-dir"), QStringLiteral("Checkout root holding runtime/rootfs.json and the web apps."), QStringLiteral("dir"));
    QCommandLineOption launchOpt(QStringLiteral("launch"), QStringLiteral("Launch this app id after start-up (repeatable)."), QStringLiteral("appId"));
    QCommandLineOption openOpt(QStringLiteral("open"), QStringLiteral("Open this web address in the browser after start-up."), QStringLiteral("url"));
    QCommandLineOption orientationOpt(QStringLiteral("orientation"), QStringLiteral("How the device is held at start-up: up (default), left (turned counter-clockwise), down or right. The window shows it as held; --size is the screen upright."), QStringLiteral("orientation"), QStringLiteral("up"));
    QCommandLineOption turnOpt(QStringLiteral("turn"), QStringLiteral("Turn the device to this orientation one second after start-up (the UI follows 200 ms later and turns for 300 ms)."), QStringLiteral("orientation"));
    parser.addOptions({ sizeOpt, scaleOpt, tabletOpt, phoneOpt, sceneOpt, shotOpt, delayOpt, qmlOpt, repoOpt, launchOpt, openOpt, orientationOpt, turnOpt });
    parser.process(app);

    const QStringList orientations = { QStringLiteral("up"), QStringLiteral("left"), QStringLiteral("down"), QStringLiteral("right") };
    const QString orientation = parser.value(orientationOpt);
    const QString turn = parser.value(turnOpt);
    if (!orientations.contains(orientation) || (parser.isSet(turnOpt) && !orientations.contains(turn))) {
        qCritical("--orientation and --turn take up, left, down or right");
        return 2;
    }

    const bool tablet = parser.isSet(tabletOpt);
    QSize size = tablet ? QSize(1024, 768) : QSize(320, 480);
    if (parser.isSet(sizeOpt)) {
        const QStringList wh = parser.value(sizeOpt).split(QLatin1Char('x'));
        if (wh.size() != 2 || wh[0].toInt() <= 0 || wh[1].toInt() <= 0) {
            qCritical("--size must look like 480x800");
            return 2;
        }
        size = QSize(wh[0].toInt(), wh[1].toInt());
    }
    // The device's screen upright; on its side the window is turned too.
    const QSize display = size;
    if (orientation == QLatin1String("left") || orientation == QLatin1String("right"))
        size.transpose();

    // A desktop window is 1.0: Qt already scales it for the monitor
    // (Retina), so the shell draws legacy pixels at the monitor's density.
    bool scaleOk = false;
    const double scale = parser.value(scaleOpt).toDouble(&scaleOk);
    if (!scaleOk || scale < 0.5 || scale > 6) {
        qCritical("--scale must be a number from 0.5 to 6");
        return 2;
    }

    QString qmlDir = parser.value(qmlOpt);
    if (qmlDir.isEmpty())
        qmlDir = QString::fromUtf8(PHOENIX_QML_DIR);
    if (qmlDir.isEmpty() || !QDir(qmlDir).exists(QStringLiteral("sim.qml")))
        qmlDir = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("../qml"));

    QString repoDir = parser.value(repoOpt);
    if (repoDir.isEmpty())
        repoDir = QString::fromUtf8(PHOENIX_REPO_DIR);
    if (repoDir.isEmpty())
        repoDir = QDir(qmlDir).filePath(QStringLiteral("../.."));
    Rootfs rootfs(repoDir);
    if (!rootfs.isValid())
        qWarning("phoenix-sim: web apps disabled: %s", qPrintable(rootfs.error()));

    QQuickView view;
    view.engine()->addImportPath(qmlDir);
    // Compiled modules (Phoenix.Native): the build tree, or installed beside
    // the QML.
    const QString qmlBuildDir = QString::fromUtf8(PHOENIX_QML_BUILD_DIR);
    if (!qmlBuildDir.isEmpty() && QDir(qmlBuildDir).exists())
        view.engine()->addImportPath(qmlBuildDir);

    bool webEngine = false;
    QVariantList webApps;
#ifdef PHOENIX_HAVE_WEBENGINE
    if (rootfs.isValid()) {
        // One persistent profile for all apps, like the single web runtime
        // on a device. Data lives under the platform's app data directory.
        auto *profile = new QQuickWebEngineProfile(&view);
        profile->setStorageName(QStringLiteral("phoenix-sim"));
        profile->setOffTheRecord(false);
        profile->installUrlSchemeHandler(Rootfs::scheme().toLatin1(), new RootfsSchemeHandler(&rootfs, profile));
        view.rootContext()->setContextProperty(QStringLiteral("phoenixWebProfile"), profile);
        webEngine = true;
        webApps = rootfs.apps();
    }
#endif
    view.rootContext()->setContextProperty(QStringLiteral("simWebEngine"), webEngine);
    view.rootContext()->setContextProperty(QStringLiteral("simWebApps"), webApps);
    view.rootContext()->setContextProperty(QStringLiteral("simLaunch"), parser.values(launchOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simOpen"), parser.value(openOpt));
    RootfsFiles rootfsFiles(&rootfs);
    view.rootContext()->setContextProperty(QStringLiteral("simRootfs"), rootfs.isValid() ? &rootfsFiles : nullptr);
    SimSettings settings;
    view.rootContext()->setContextProperty(QStringLiteral("simSettings"), &settings);
    view.rootContext()->setContextProperty(QStringLiteral("simScene"), parser.value(sceneOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simDensity"), scale);
    view.rootContext()->setContextProperty(QStringLiteral("simDisplayWidth"), display.width());
    view.rootContext()->setContextProperty(QStringLiteral("simDisplayHeight"), display.height());
    view.rootContext()->setContextProperty(QStringLiteral("simOrientation"), orientation);
    view.rootContext()->setContextProperty(QStringLiteral("simTurn"), turn);
    view.rootContext()->setContextProperty(QStringLiteral("simFormFactor"),
        tablet ? QStringLiteral("tablet") : parser.isSet(phoneOpt) ? QStringLiteral("phone") : QStringLiteral("auto"));
    view.setResizeMode(QQuickView::SizeRootObjectToView);
    view.resize(size);
    view.setTitle(QStringLiteral("webOS Phoenix"));
    view.setSource(QUrl::fromLocalFile(QDir(qmlDir).filePath(QStringLiteral("sim.qml"))));
    if (view.status() != QQuickView::Ready)
        return 1;
    view.show();

    if (parser.isSet(shotOpt)) {
        const QString file = parser.value(shotOpt);
        QTimer::singleShot(parser.value(delayOpt).toInt(), &view, [&view, file]() {
            const bool ok = view.grabWindow().save(file);
            if (!ok)
                qCritical("Could not write %s", qPrintable(file));
            QCoreApplication::exit(ok ? 0 : 1);
        });
    }

    return app.exec();
}
