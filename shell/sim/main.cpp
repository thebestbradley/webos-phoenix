// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim: runs the Phoenix shell in a desktop window with mock apps.
//
//   phoenix-sim [--size WxH] [--scale N] [--tablet|--phone] [--scene NAME]
//               [--orientation up|left|down|right] [--turn ORIENTATION]
//               [--home-button] [--first-use] [--screenshot FILE [--delay MS]] [--stay-awake] [--no-host-shell]
//               [--host-shell PATH]
//
// Keys: Esc = back gesture, Home/F1 = up gesture, F2 = demo notification,
//       F3 = Power (screen off and locked / on), F4 = incoming call, F5 = incoming text message,
//       F6 = low battery, F7 = charger in/out, F10 / F11 = volume down / up, F9 / Print Screen /
//       Ctrl+Alt+P (Command or Control+Option+P on a Mac) = screen capture,
//       Home + F3 together = screen capture, Ctrl+Left / Ctrl+Right =
//       turn the device a quarter turn counter-clockwise / clockwise.
//       Type in card view for Just Type.

#include <QCommandLineParser>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFontDatabase>
#include <QGuiApplication>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickView>
#include <QStandardPaths>
#include <QTimer>

#ifdef Q_OS_LINUX
#include <unistd.h>
#endif

#include "rootfs.h"
#include "siminstaller.h"
#include "simpty.h"
#include "simsettings.h"
#include "simprocess.h"

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

// Colour emoji (shell/assets/fonts/noto-color-emoji, GAPS V6). The shell
// loads the font itself (Theme.qml); the web runtime finds fonts through
// fontconfig, and both take the order from it. So on Linux, before Qt or
// Chromium read fontconfig, its configuration gets the font's directory and
// the rule that puts it after the text fonts, as on a device, where both
// are installed (/usr/share/fonts, /etc/fonts/conf.d). macOS has Apple
// Color Emoji, for the shell and the web pages.
static void useBundledEmojiFont(int argc, char *argv[])
{
#ifdef Q_OS_LINUX
    if (!qEnvironmentVariableIsEmpty("FONTCONFIG_FILE"))
        return;
    // The QML directory: --qml-dir, the build's, or ../qml beside the program.
    QString qmlDir;
    for (int i = 1; i < argc; ++i) {
        const QString arg = QString::fromLocal8Bit(argv[i]);
        if (arg == QLatin1String("--qml-dir") && i + 1 < argc)
            qmlDir = QString::fromLocal8Bit(argv[i + 1]);
        else if (arg.startsWith(QLatin1String("--qml-dir=")))
            qmlDir = arg.mid(10);
    }
    if (qmlDir.isEmpty())
        qmlDir = QString::fromUtf8(PHOENIX_QML_DIR);
    if (qmlDir.isEmpty())
        qmlDir = QFileInfo(QString::fromLocal8Bit(argv[0])).absoluteDir().filePath(QStringLiteral("../qml"));
    const QDir emojiDir(QDir(qmlDir).absoluteFilePath(QStringLiteral("../assets/fonts/noto-color-emoji")));
    if (!emojiDir.exists(QStringLiteral("NotoColorEmoji.ttf")))
        return;
    const QString confDir = QDir::temp().filePath(QStringLiteral("phoenix-sim-fonts-") + QString::number(getuid()));
    QDir().mkpath(confDir);
    QFile conf(QDir(confDir).filePath(QStringLiteral("fonts.conf")));
    if (!conf.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return;
    conf.write("<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"urn:fontconfig:fonts.dtd\">\n<fontconfig>\n"
               "  <include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>\n"
               "  <dir>" + emojiDir.absolutePath().toHtmlEscaped().toUtf8() + "</dir>\n"
               "  <include ignore_missing=\"yes\">"
               + emojiDir.absoluteFilePath(QStringLiteral("50-phoenix-emoji.conf")).toHtmlEscaped().toUtf8()
               + "</include>\n</fontconfig>\n");
    conf.close();
    qputenv("FONTCONFIG_FILE", conf.fileName().toLocal8Bit());
#else
    Q_UNUSED(argc);
    Q_UNUSED(argv);
#endif
}

int main(int argc, char *argv[])
{
    useBundledEmojiFont(argc, argv);
#ifdef PHOENIX_HAVE_WEBENGINE
    // Both must happen before the application object exists.
    RootfsSchemeHandler::registerScheme();
    QtWebEngineQuick::initialize();
#endif
    QGuiApplication app(argc, argv);
#if QT_VERSION >= QT_VERSION_CHECK(6, 9, 0) && !defined(Q_OS_DARWIN)
    // Emoji presentation from the colour font, whatever the text font.
    QFontDatabase::addApplicationEmojiFontFamily(QStringLiteral("Noto Color Emoji"));
#endif
    app.setApplicationName(QStringLiteral("phoenix-sim"));
    app.setOrganizationName(QStringLiteral("webos-phoenix"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("webOS Phoenix shell simulator"));
    parser.addHelpOption();
    QCommandLineOption sizeOpt(QStringLiteral("size"), QStringLiteral("Window size in pixels (default 320x480, tablet 1024x768)."), QStringLiteral("WxH"));
    QCommandLineOption scaleOpt(QStringLiteral("scale"), QStringLiteral("Device pixels per legacy pixel, like a denser screen (default 1; the Pre 3 was 1.5 at 480x800)."), QStringLiteral("N"), QStringLiteral("1"));
    QCommandLineOption tabletOpt(QStringLiteral("tablet"), QStringLiteral("Use the tablet (TouchPad) layout."));
    QCommandLineOption phoneOpt(QStringLiteral("phone"), QStringLiteral("Force the phone layout."));
    QCommandLineOption sceneOpt(QStringLiteral("scene"), QStringLiteral("Demo scene: locked, cards, stacks, reorder, maximized, heldcard, launcher, launcheredit, pin, emergency, firstuse, lowbattery, banner, notified, dashboard, justtype, keyboard, systemmenu, empty."), QStringLiteral("name"));
    QCommandLineOption firstUseOpt(QStringLiteral("first-use"), QStringLiteral("Start with First Use, as on a new device (without it, First Use runs until it has been done once, unless --scene or --launch is given)."));
    QCommandLineOption shotOpt(QStringLiteral("screenshot"), QStringLiteral("Save a screenshot to FILE and exit."), QStringLiteral("file"));
    QCommandLineOption delayOpt(QStringLiteral("delay"), QStringLiteral("Delay before the screenshot (default 1500 ms)."), QStringLiteral("ms"), QStringLiteral("1500"));
    QCommandLineOption qmlOpt(QStringLiteral("qml-dir"), QStringLiteral("Directory containing sim.qml and the Phoenix modules."), QStringLiteral("dir"));
    QCommandLineOption repoOpt(QStringLiteral("repo-dir"), QStringLiteral("Checkout root holding runtime/rootfs.json and the web apps."), QStringLiteral("dir"));
    QCommandLineOption installedOpt(QStringLiteral("installed-dir"), QStringLiteral("Where apps the user installs go (default: the simulator's data folder, cryptofs/apps)."), QStringLiteral("dir"));
    QCommandLineOption launchOpt(QStringLiteral("launch"), QStringLiteral("Launch this app id after start-up (repeatable)."), QStringLiteral("appId"));
    QCommandLineOption openOpt(QStringLiteral("open"), QStringLiteral("Open this web address in the browser after start-up."), QStringLiteral("url"));
    QCommandLineOption orientationOpt(QStringLiteral("orientation"), QStringLiteral("How the device is held at start-up: up (default), left (turned counter-clockwise), down or right. The window shows it as held; --size is the screen upright."), QStringLiteral("orientation"), QStringLiteral("up"));
    QCommandLineOption turnOpt(QStringLiteral("turn"), QStringLiteral("Turn the device to this orientation one second after start-up (the UI follows 200 ms later and turns for 300 ms)."), QStringLiteral("orientation"));
    QCommandLineOption homeButtonOpt(QStringLiteral("home-button"), QStringLiteral("The device has a hardware Home button its maker uses instead of the gesture bar (the TouchPad): no gesture bar; the Home key presses the button."));
    QCommandLineOption stayAwakeOpt(QStringLiteral("stay-awake"), QStringLiteral("The screen never dims or turns off by itself (always so with --screenshot)."));
    QCommandLineOption quietOpt(QStringLiteral("quiet"), QStringLiteral("No boot and shutdown sounds (they are off anyway with --screenshot and the offscreen platform)."));
    QCommandLineOption noHostShellOpt(QStringLiteral("no-host-shell"), QStringLiteral("Do not give the Terminal app a real shell on this computer (it gets the runtime's simulated shell)."));
    QCommandLineOption hostShellOpt(QStringLiteral("host-shell"), QStringLiteral("Run this program in the Terminal instead of the shell it asks for."), QStringLiteral("path"));
    parser.addOptions({ stayAwakeOpt, sizeOpt, scaleOpt, tabletOpt, phoneOpt, sceneOpt, firstUseOpt, shotOpt, delayOpt, qmlOpt, repoOpt, installedOpt, launchOpt, openOpt, orientationOpt, turnOpt, quietOpt, homeButtonOpt,
                        noHostShellOpt, hostShellOpt });
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
    // The keyboard's dictation transcribes with the device's own transcriber
    // code (whisper.cpp) on this computer.
    const QStringList transcriberCommand = { QStringLiteral("node"),
        QDir(repoDir).filePath(QStringLiteral("apps/voicememos/service/transcribe-cli.js")),
        QStringLiteral("%f"), QStringLiteral("%l") };
    if (!rootfs.isValid())
        qWarning("phoenix-sim: web apps disabled: %s", qPrintable(rootfs.error()));
    // Apps the user installs (the Marketplace, Files' .ipk sheet) live with
    // the simulator's other data, as on a device in /media/cryptofs/apps.
    if (rootfs.isValid())
        rootfs.setInstalledDir(parser.isSet(installedOpt) ? parser.value(installedOpt)
            : QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).filePath(QStringLiteral("cryptofs/apps")));
    SimInstaller installer(&rootfs);

    // The Terminal's shells: real ones on this computer (docs/TERMINAL.md),
    // unless turned off. The runtime learns which from /usr/share/phoenix/host.json.
    SimPty *simPty = nullptr;
    if (!parser.isSet(noHostShellOpt)) {
        simPty = new SimPty(&app);
        simPty->setShellOverride(parser.value(hostShellOpt));
        rootfs.setHostInfo(QByteArrayLiteral("{\"pty\":\"host\"}"));
    }

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
#if QT_VERSION >= QT_VERSION_CHECK(6, 9, 0)
        // Made with its storage from the start (Qt 6.9): the parent-only
        // constructor makes an off-the-record profile first, and warns.
        auto *profile = new QQuickWebEngineProfile(QStringLiteral("phoenix-sim"), &view);
#else
        auto *profile = new QQuickWebEngineProfile(&view);
        profile->setStorageName(QStringLiteral("phoenix-sim"));
        profile->setOffTheRecord(false);
#endif
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
    SimProcess simProcess;
    view.rootContext()->setContextProperty(QStringLiteral("simProcess"), &simProcess);
    view.rootContext()->setContextProperty(QStringLiteral("simTranscriberCommand"), transcriberCommand);
    view.rootContext()->setContextProperty(QStringLiteral("simSettings"), &settings);
    view.rootContext()->setContextProperty(QStringLiteral("simPty"), simPty);
    view.rootContext()->setContextProperty(QStringLiteral("simInstaller"), rootfs.isValid() ? &installer : nullptr);
    view.rootContext()->setContextProperty(QStringLiteral("simScene"), parser.value(sceneOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simFirstUse"), parser.isSet(firstUseOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simStayAwake"), parser.isSet(stayAwakeOpt) || parser.isSet(shotOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simDensity"), scale);
    view.rootContext()->setContextProperty(QStringLiteral("simHomeButton"), parser.isSet(homeButtonOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simDisplayWidth"), display.width());
    view.rootContext()->setContextProperty(QStringLiteral("simDisplayHeight"), display.height());
    view.rootContext()->setContextProperty(QStringLiteral("simOrientation"), orientation);
    view.rootContext()->setContextProperty(QStringLiteral("simTurn"), turn);
    // The boot and shutdown sounds, only when someone is there to hear them.
    const QString platform = QGuiApplication::platformName();
    view.rootContext()->setContextProperty(QStringLiteral("simBootSounds"),
        !parser.isSet(quietOpt) && !parser.isSet(shotOpt) && platform != QLatin1String("offscreen") && platform != QLatin1String("minimal"));
    // Qt.quit() (after the shutdown sound).
    QObject::connect(view.engine(), &QQmlEngine::quit, &app, &QCoreApplication::quit, Qt::QueuedConnection);
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
