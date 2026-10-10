// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim, the Phoenix WebOS Simulator: runs the Phoenix shell in a
// desktop window with mock apps, under menus (Device, Simulate, View, Help)
// and beside a toolbar with every key below (SimChrome; sim.qml simActions).
//
//   phoenix-sim [--size WxH] [--scale N] [--adaptive|--tablet|--phone] [--scene NAME]
//               [--orientation up|left|down|right] [--turn ORIENTATION]
//               [--home-button] [--first-use] [--screenshot FILE [--delay MS]] [--stay-awake] [--low-memory] [--hardware-keyboard] [--touchstone] [--no-host-shell]
//               [--host-shell PATH] [--security-policy SPEC] [--usb] [--usb-busy] [--touch-to-share]
//               [--boot-animation | --no-boot-animation] [--no-toolbar] [--marketplace] [--check-chrome]
//
// Keys: Esc = back gesture, Home/F1 = up gesture, F2 = demo notification,
//       F3 = Power (screen off and locked / on), F4 = incoming call, F5 = incoming text message
//       (Shift+F5 a picture message, Ctrl+F5 an instant message),
//       F6 = low battery, Shift+F6 = battery not reporting, F7 = charger in/out, F12 = Touchstone (inductive charger: dock mode) on/off, Shift+F12 = onto the other Touchstone,
//       F10 / F11 = volume down / up, F9 / Print Screen /
//       Ctrl+Alt+P (Command or Control+Option+P on a Mac) = screen capture,
//       Ctrl+Shift+K = attach or detach a hardware keyboard,
//       Home + F3 together = screen capture, Ctrl+Left / Ctrl+Right =
//       turn the device a quarter turn counter-clockwise / clockwise,
//       Shift+F8 = a USB cable from a computer in / out, Ctrl+F8 = the computer
//       ejects the USB drive; F3 + F11 held, then Home = Full Erase,
//       F3 + F10 = USB drive mode; Shift+F7 = a Touch to Share phone in range or
//       gone, Ctrl+F7 = it touches the device; Ctrl+Shift+G = a game
//       controller (Ctrl+Shift+A presses A), Ctrl+Shift+U = a USB drive in
//       the device's port, Ctrl+Shift+T = the battery's next temperature.
//       Type in card view for Just Type.

#include <QCommandLineParser>
#include <QDir>
#include <QProcess>
#include <QFile>
#include <QFileInfo>
#include <QFontDatabase>
#include <QApplication>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickView>
#include <QStandardPaths>
#include <QScopeGuard>
#include <QTimer>
#include <QVersionNumber>
#include <cstdio>

#include <memory>

#ifdef Q_OS_LINUX
#include <unistd.h>
#endif

#include "rootfs.h"
#include "simchrome.h"
#include "simfonts.h"
#include "siminstaller.h"
#include "simsnapshots.h"
#include "simpty.h"
#include "simsettings.h"
#include "simprocess.h"
#ifdef PHOENIX_HAVE_WEBENGINE
#include "simmarketplace.h"
#endif

#ifdef PHOENIX_HAVE_WEBENGINE
#include <QQuickWebEngineProfile>
#include <QtWebEngineQuick>
#include "simbrowser.h"
#include "simdropshare.h"
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
    const QString conf = SimFonts::writeEmojiFontConfig(
        QDir(qmlDir).absoluteFilePath(QStringLiteral("../assets/fonts/noto-color-emoji")),
        QDir::temp().filePath(QStringLiteral("phoenix-sim-fonts-") + QString::number(getuid())));
    if (conf.isEmpty())
        return;
    qputenv("FONTCONFIG_FILE", QFile::encodeName(conf));
#else
    Q_UNUSED(argc);
    Q_UNUSED(argv);
#endif
}

int main(int argc, char *argv[])
{
    // Built against Qt 6.8 or newer (CMakeLists.txt), and run with it: an
    // older Qt found first at run time is refused here, before it draws
    // (Qt 6.4 aborts drawing styled text with the colour emoji font).
    if (QVersionNumber::fromString(QLatin1String(qVersion())) < QVersionNumber(6, 8)) {
        std::fprintf(stderr, "phoenix-sim: Qt %s is too old; it needs Qt 6.8 or newer (built with %s).\n", qVersion(), QT_VERSION_STR);
        return 1;
    }
    useBundledEmojiFont(argc, argv);
#ifdef PHOENIX_HAVE_WEBENGINE
    // Both must happen before the application object exists.
    RootfsSchemeHandler::registerScheme();
    QtWebEngineQuick::initialize();
#endif
    // QApplication: the window's menu bar and toolbar are widgets.
    QApplication app(argc, argv);
#if QT_VERSION >= QT_VERSION_CHECK(6, 9, 0) && !defined(Q_OS_DARWIN)
    // Emoji presentation from the colour font, whatever the text font.
    QFontDatabase::addApplicationEmojiFontFamily(QStringLiteral("Noto Color Emoji"));
#endif
    // These two name the settings file and the data folders: as they were,
    // so a simulated device keeps its data. People see the display name.
    app.setApplicationName(QStringLiteral("phoenix-sim"));
    app.setOrganizationName(QStringLiteral("webos-phoenix"));
    QGuiApplication::setApplicationDisplayName(SimChrome::displayName());

    QCommandLineParser parser;
    parser.setApplicationDescription(SimChrome::displayName() + QStringLiteral(": the webOS Phoenix shell on the desktop. Its menus and Help > Keyboard Shortcuts list the keys."));
    parser.addHelpOption();
    QCommandLineOption sizeOpt(QStringLiteral("size"), QStringLiteral("Window size in pixels (default 320x480, tablet 1024x768)."), QStringLiteral("WxH"));
    QCommandLineOption scaleOpt(QStringLiteral("scale"), QStringLiteral("Device pixels per legacy pixel, like a denser screen (default 1; the Pre 3 was 1.5 at 480x800)."), QStringLiteral("N"), QStringLiteral("1"));
    QCommandLineOption tabletOpt(QStringLiteral("tablet"), QStringLiteral("Use the tablet (TouchPad) layout."));
    QCommandLineOption phoneOpt(QStringLiteral("phone"), QStringLiteral("Force the phone layout."));
    QCommandLineOption adaptiveOpt(QStringLiteral("adaptive"), QStringLiteral("A phone or a tablet by the window's size (the default without --phone or --tablet): resize the window, or pick View > Device Size, and the shell switches between the layouts live, the apps running on."));
    QCommandLineOption sceneOpt(QStringLiteral("scene"), QStringLiteral("Demo scene: locked, cards, stacks, reorder, maximized, heldcard, launcher, launcheredit, launchermenu, launchergroup, launchergroupopen, launchertabs, launcherinstall, wave, powermenu, pin, emergency, firstuse, lowbattery, banner, notified, dashboard, justtype, keyboard, clipstrip, assistant, systemmenu, modal, empty."), QStringLiteral("name"));
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
    QCommandLineOption lowMemoryOpt(QStringLiteral("low-memory"), QStringLiteral("Act as if memory were low: launching an app shows \"Sorry, Too Many Cards\"."));
    QCommandLineOption touchstoneOpt(QStringLiteral("touchstone"), QStringLiteral("Start on a Touchstone (the inductive charger), in dock mode: its exhibition showing (F12 sets the device on one or lifts it off)."));
    QCommandLineOption hardwareKeyboardOpt(QStringLiteral("hardware-keyboard"), QStringLiteral("Start with a hardware keyboard attached (Ctrl+Shift+K attaches or detaches it): the virtual keyboard stays down unless asked for."));
    QCommandLineOption stayAwakeOpt(QStringLiteral("stay-awake"), QStringLiteral("The screen never dims or turns off by itself (always so with --screenshot)."));
    QCommandLineOption quietOpt(QStringLiteral("quiet"), QStringLiteral("No boot and shutdown sounds (they are off anyway with --screenshot and the offscreen platform)."));
    QCommandLineOption noHostShellOpt(QStringLiteral("no-host-shell"), QStringLiteral("Do not give the Terminal app a real shell on this computer (it gets the runtime's simulated shell)."));
    QCommandLineOption llamaServerOpt(QStringLiteral("llama-server"), QStringLiteral("llama.cpp's llama-server program for the Assistant's on-device model (default: llama-server on the PATH)."), QStringLiteral("path"));
    QCommandLineOption marketplaceOpt(QStringLiteral("marketplace"), QStringLiteral("Start the Marketplace's catalog service on this computer (server/marketplace/bin/serve.sh: PHP 8; set up the first time) where the simulator's Marketplace reads it, http://127.0.0.1:8088/, and open the Marketplace. It stops with the simulator; one already running is used. The Services menu starts and stops it too."));
    QCommandLineOption speechCommandOpt(QStringLiteral("speech-command"), QStringLiteral("The program (and arguments, %l for the language, %v for the voice) that speaks the Assistant's answers, given the text on its input (default: Kitten TTS, phoenix-tts; else espeak-ng, say or Flite)."), QStringLiteral("command"));
    QCommandLineOption wakeModelOpt(QStringLiteral("wake-model"), QStringLiteral("The wake word's Vosk model folder (default: wakeword/vosk-model-small-en-us-0.15 beside phoenix-sim, which tools/get-wakeword.py fetches)."), QStringLiteral("dir"));
    QCommandLineOption voskLibraryOpt(QStringLiteral("vosk-library"), QStringLiteral("libvosk for the wake word (default: wakeword/libvosk.so, or .dylib, beside phoenix-sim)."), QStringLiteral("file"));
    QCommandLineOption wakeFileOpt(QStringLiteral("wake-file"), QStringLiteral("The WAV file Simulate > Say \"Hey Phoenix\" plays into the microphone (default: the tests' hey-phoenix.wav)."), QStringLiteral("file"));
    QCommandLineOption microphoneFileOpt(QStringLiteral("microphone-file"), QStringLiteral("Play this WAV file as the microphone when dictation or Voice Dial listens, followed by quiet; for computers without one and for tests. Repeat it for the following recordings (the last one plays again after that)."), QStringLiteral("file"));
    QCommandLineOption hostShellOpt(QStringLiteral("host-shell"), QStringLiteral("Run this program in the Terminal instead of the shell it asks for."), QStringLiteral("path"));
    QCommandLineOption policyOpt(QStringLiteral("security-policy"), QStringLiteral("A device security policy, as an Exchange account sets one (EAS): comma-separated minLength=N, maxRetries=N (the last wrong try erases the device), alphaNumeric (a password, letters and digits), noSimple (no runs like 1234 or 1111), inactivity=SECONDS (the longest Lock after); \"none\" removes it. It is kept until removed or the device is erased."), QStringLiteral("spec"));
    QCommandLineOption usbOpt(QStringLiteral("usb"), QStringLiteral("Start with a USB cable from a computer plugged in (Shift+F8 plugs it in or out, Ctrl+F8 ejects the USB drive on the computer)."));
    QCommandLineOption touchToShareOpt(QStringLiteral("touch-to-share"), QStringLiteral("Start with a Touch to Share phone in range: the glow at the bottom of the screen (Shift+F7 brings it or takes it away, Ctrl+F7 touches it to the device and sends what the app in front shares)."));
    QCommandLineOption usbBusyOpt(QStringLiteral("usb-busy"), QStringLiteral("An app keeps a file open on the USB drive: entering USB drive mode fails (\"USB Drive connection failed\")."));
    QCommandLineOption bootAnimOpt(QStringLiteral("boot-animation"), QStringLiteral("Show the boot animation at start-up (it shows anyway unless --screenshot or an offscreen platform)."));
    QCommandLineOption noBootAnimOpt(QStringLiteral("no-boot-animation"), QStringLiteral("Start without the boot animation."));
    QCommandLineOption checkChromeOpt(QStringLiteral("check-chrome"), QStringLiteral("Check that the menu bar shows its menus with the keyboard focus on the screen (on a Mac: the menu bar at the top of the screen) and that the focus goes back to the screen from the window around it, print what it found, and exit: 0 if so (CI)."));
    QCommandLineOption noToolbarOpt(QStringLiteral("no-toolbar"), QStringLiteral("Start without the toolbar beside the screen (View > Show Toolbar shows it again)."));
    // Set by phoenix-sim itself when it restarts (SimProcess).
    QCommandLineOption updatingOpt(QStringLiteral("updating"), QStringLiteral("Boot as after a system update: \"Updating the system\" first."));
    QCommandLineOption eraseOpt(QStringLiteral("erase-data"), QStringLiteral("Internal: once process PID is gone, erase the simulator's data and start into First Use."), QStringLiteral("pid"));
    updatingOpt.setFlags(QCommandLineOption::HiddenFromHelp);
    eraseOpt.setFlags(QCommandLineOption::HiddenFromHelp);
    parser.addOptions({ hardwareKeyboardOpt, lowMemoryOpt, touchstoneOpt, stayAwakeOpt, sizeOpt, scaleOpt, tabletOpt, phoneOpt, adaptiveOpt, sceneOpt, firstUseOpt, shotOpt, delayOpt, qmlOpt, repoOpt, installedOpt, launchOpt, openOpt, orientationOpt, turnOpt, quietOpt, homeButtonOpt,
                        noHostShellOpt, hostShellOpt, policyOpt, usbOpt, usbBusyOpt, touchToShareOpt, bootAnimOpt, noBootAnimOpt, noToolbarOpt, checkChromeOpt, updatingOpt, eraseOpt, microphoneFileOpt,
                        llamaServerOpt, speechCommandOpt, marketplaceOpt, wakeModelOpt, voskLibraryOpt, wakeFileOpt });
    parser.process(app);

    // A Full Erase or a security policy's wipe restarted the simulator:
    // its data goes before anything reads it.
    if (parser.isSet(eraseOpt))
        SimProcess::eraseData(parser.value(eraseOpt).toLongLong());

    // --security-policy: a com.palm.securitypolicy:1 object in db8, as an
    // EAS account wrote one (EASPolicyManager.cpp:60-80); sim.qml puts it there.
    QString securityPolicy;
    if (parser.isSet(policyOpt)) {
        const QString spec = parser.value(policyOpt).trimmed();
        if (spec == QLatin1String("none")) {
            securityPolicy = QStringLiteral("none");
        } else {
            QJsonObject policy { { QStringLiteral("devicePasswordEnabled"), true } };
            for (const QString &part : spec.split(QLatin1Char(','), Qt::SkipEmptyParts)) {
                const QString key = part.section(QLatin1Char('='), 0, 0).trimmed();
                const QString value = part.section(QLatin1Char('='), 1).trimmed();
                bool ok = true;
                if (key == QLatin1String("minLength"))
                    policy.insert(QStringLiteral("minDevicePasswordLength"), value.toInt(&ok));
                else if (key == QLatin1String("maxRetries"))
                    policy.insert(QStringLiteral("maxDevicePasswordFailedAttempts"), value.toInt(&ok));
                else if (key == QLatin1String("inactivity"))
                    policy.insert(QStringLiteral("maxInactivityTimeDeviceLock"), value.toInt(&ok));
                else if (key == QLatin1String("alphaNumeric") && value.isEmpty())
                    policy.insert(QStringLiteral("alphanumericDevicePasswordRequired"), true);
                else if (key == QLatin1String("noSimple") && value.isEmpty())
                    policy.insert(QStringLiteral("allowSimpleDevicePassword"), false);
                else
                    ok = false;
                if (!ok) {
                    qCritical("--security-policy: did not understand \"%s\" (minLength=N, maxRetries=N, alphaNumeric, noSimple, inactivity=SECONDS, or none)",
                              qPrintable(part));
                    return 2;
                }
            }
            if (!policy.contains(QStringLiteral("maxInactivityTimeDeviceLock")))
                policy.insert(QStringLiteral("maxInactivityTimeDeviceLock"), 9998);   // no limit (EASPolicyManager.h:45)
            securityPolicy = QString::fromUtf8(QJsonDocument(policy).toJson(QJsonDocument::Compact));
        }
    }

    const QStringList orientations = { QStringLiteral("up"), QStringLiteral("left"), QStringLiteral("down"), QStringLiteral("right") };
    const QString orientation = parser.value(orientationOpt);
    const QString turn = parser.value(turnOpt);
    if (!orientations.contains(orientation) || (parser.isSet(turnOpt) && !orientations.contains(turn))) {
        qCritical("--orientation and --turn take up, left, down or right");
        return 2;
    }

    if (int(parser.isSet(tabletOpt)) + int(parser.isSet(phoneOpt)) + int(parser.isSet(adaptiveOpt)) > 1) {
        qCritical("--adaptive, --phone and --tablet: one of them");
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
        QStringLiteral("%f"), QStringLiteral("%l"), QStringLiteral("%p") };
    if (!rootfs.isValid())
        qWarning("phoenix-sim: web apps disabled: %s", qPrintable(rootfs.error()));
    else if (!rootfs.missing().isEmpty())
        qWarning("phoenix-sim: missing from the checkout (%s): %s. The original webOS apps and frameworks there are left out; "
                 "fetch the git submodules with `git submodule update --init` (./phoenix does), then start phoenix-sim again.",
                 qPrintable(QDir::toNativeSeparators(QDir(repoDir).absolutePath())), qPrintable(rootfs.missing().join(QStringLiteral(", "))));
    // Apps the user installs (the Marketplace, Files' .ipk sheet) live with
    // the simulator's other data, as on a device in /media/cryptofs/apps.
    // /var/luna/ (launch points apps add, the browser's page pictures) in
    // the simulator's data folder; read with the apps below.
    if (rootfs.isValid())
        rootfs.setDataDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation));
    if (rootfs.isValid())
        rootfs.setInstalledDir(parser.isSet(installedOpt) ? parser.value(installedOpt)
            : QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).filePath(QStringLiteral("cryptofs/apps")));
    SimInstaller installer(&rootfs);
    // The browser's page pictures (saveViewToFile, generateIconFromFile).
    SimSnapshots snapshots(&rootfs);

    // The Marketplace's catalog service (Services > Marketplace Catalog,
    // the Marketplace's Start Local Catalog). --marketplace: started,
    // answering before the Marketplace first reads it; with Services >
    // Start Catalog with the Simulator ("marketplace/autostart"), started
    // without waiting.
    QStringList launch = parser.values(launchOpt);
#ifdef PHOENIX_HAVE_WEBENGINE
    auto marketplace = std::make_unique<SimMarketplace>(repoDir);
    if (!parser.isSet(marketplaceOpt) && SimSettings().value(QStringLiteral("marketplace/autostart")) == QLatin1String("1")) {
        qInfo("phoenix-sim: starting the Marketplace's catalog (Services > Start Catalog with the Simulator)");
        marketplace->startAsync();
    }
    if (parser.isSet(marketplaceOpt)) {
        if (marketplace->start())
            qInfo("phoenix-sim: the Marketplace's catalog at %s%s", qPrintable(marketplace->url()),
                  marketplace->ownsServer() ? qPrintable(QStringLiteral(" (log: ") + marketplace->logFile() + QLatin1Char(')')) : " (already running)");
        else
            qWarning("phoenix-sim: --marketplace: %s", qPrintable(marketplace->error()));
        if (!launch.contains(QStringLiteral("org.webosphoenix.marketplace")))
            launch << QStringLiteral("org.webosphoenix.marketplace");
    }
#else
    if (parser.isSet(marketplaceOpt))
        qWarning("phoenix-sim: --marketplace needs web apps (Qt WebEngine)");
#endif

    // The Terminal's shells: real ones on this computer (docs/TERMINAL.md),
    // unless turned off. The runtime learns which from /usr/share/phoenix/host.json.
    // The shell's dictation (the microphone and the transcriber) serves the
    // apps too: org.webosphoenix.dictation (Voice Dial).
    SimPty *simPty = nullptr;
    QJsonObject hostInfo{ { QStringLiteral("dictation"), true }, { QStringLiteral("assistant"), true } };
#ifdef PHOENIX_HAVE_WEBENGINE
    // The simulator starts the catalog service when the Marketplace asks
    // (the runtime's org.webosphoenix.simulator).
    hostInfo.insert(QStringLiteral("marketplaceCatalog"), true);
#endif
    if (!parser.isSet(noHostShellOpt)) {
        simPty = new SimPty(&app);
        simPty->setShellOverride(parser.value(hostShellOpt));
        hostInfo.insert(QStringLiteral("pty"), QStringLiteral("host"));
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
        auto *schemeHandler = new RootfsSchemeHandler(&rootfs, profile);
        schemeHandler->setSnapshots(&snapshots);
        // DropShare's server, which the apps' pages run (the runtime's
        // org.webosphoenix.dropshare); the pages other devices open are
        // the DropShare app's own (web/receive.html, web/send.html).
        auto *dropShare = new SimDropShare([&rootfs](const QString &name) {
            QFile f(rootfs.resolve(QStringLiteral("/usr/palm/applications/org.webosphoenix.dropshare/web/") + name));
            return f.open(QIODevice::ReadOnly) ? f.readAll() : QByteArray();
        }, &view);
        schemeHandler->setDropShare(dropShare);
        profile->installUrlSchemeHandler(Rootfs::scheme().toLatin1(), schemeHandler);
        view.rootContext()->setContextProperty(QStringLiteral("phoenixWebProfile"), profile);
        // The pages apps show in a page view (the browser's): a profile of
        // their own, its settings, the system proxy.
        auto *simBrowser = new SimBrowser(&rootfs, &snapshots, !tablet && qMin(display.width(), display.height()) < 600, &view);
        view.rootContext()->setContextProperty(QStringLiteral("simBrowser"), simBrowser);
        webEngine = true;
        webApps = rootfs.apps();
    }
#endif
    view.rootContext()->setContextProperty(QStringLiteral("simWebEngine"), webEngine);
    view.rootContext()->setContextProperty(QStringLiteral("simWebApps"), webApps);
    view.rootContext()->setContextProperty(QStringLiteral("simLaunch"), launch);
    view.rootContext()->setContextProperty(QStringLiteral("simLowMemory"), parser.isSet(lowMemoryOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simTouchstone"), parser.isSet(touchstoneOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simHardwareKeyboard"), parser.isSet(hardwareKeyboardOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simOpen"), parser.value(openOpt));
    RootfsFiles rootfsFiles(&rootfs);
    view.rootContext()->setContextProperty(QStringLiteral("simRootfs"), rootfs.isValid() ? &rootfsFiles : nullptr);
    SimSettings settings;
    SimProcess simProcess;
    view.rootContext()->setContextProperty(QStringLiteral("simProcess"), &simProcess);
    view.rootContext()->setContextProperty(QStringLiteral("simTranscriberCommand"), transcriberCommand);
    QStringList microphoneFiles;
    for (const QString &f : parser.values(microphoneFileOpt))
        microphoneFiles << QFileInfo(f).absoluteFilePath();
    view.rootContext()->setContextProperty(QStringLiteral("simMicrophoneFiles"), microphoneFiles);
    // "Hey Phoenix": phoenix-wakeword (built beside phoenix-sim) with Vosk's
    // library and model (tools/get-wakeword.py puts them in wakeword/ here).
    {
        const QDir here(QCoreApplication::applicationDirPath());
#ifdef Q_OS_MACOS
        const QString lib = QStringLiteral("wakeword/libvosk.dylib");
#else
        const QString lib = QStringLiteral("wakeword/libvosk.so");
#endif
        const QString model = parser.isSet(wakeModelOpt) ? parser.value(wakeModelOpt)
                                                         : here.filePath(QStringLiteral("wakeword/vosk-model-small-en-us-0.15"));
        const QString vosk = parser.isSet(voskLibraryOpt) ? parser.value(voskLibraryOpt) : here.filePath(lib);
        const QString spotter = here.filePath(QStringLiteral("phoenix-wakeword"));
        QStringList wakeCommand;
        if (QFileInfo::exists(spotter) && QFileInfo(model).isDir() && QFileInfo::exists(vosk))
            wakeCommand = { spotter, QStringLiteral("--model"), QFileInfo(model).absoluteFilePath(),
                            QStringLiteral("--vosk"), QFileInfo(vosk).absoluteFilePath() };
        view.rootContext()->setContextProperty(QStringLiteral("simWakeWordCommand"), wakeCommand);
        view.rootContext()->setContextProperty(QStringLiteral("simWakeFile"),
            parser.isSet(wakeFileOpt) ? QFileInfo(parser.value(wakeFileOpt)).absoluteFilePath()
                                      : QDir(repoDir).filePath(QStringLiteral("services/wakeword/tests/data/hey-phoenix.wav")));

        // What the assistant's voice and model have on this computer, for
        // Settings > Assistant (the runtime's voice reads host.json's
        // "voice") and for this log, each missing one with a line on how to
        // get it (./phoenix installs them all; docs/AI-AND-MCP.md, "What's
        // installed where").
        QJsonObject voice;
        // hint: what is missing and how to get it, after the part's name
        // ("speech recognition: its model is missing; run ...").
        const auto part = [&voice](const char *id, const char *what, bool available, const QString &engine, const QString &hint) {
            voice.insert(QLatin1String(id), QJsonObject{ { QStringLiteral("available"), available },
                { QStringLiteral("engine"), engine }, { QStringLiteral("howToInstall"), available ? QString() : hint } });
            if (!available)
                qInfo("phoenix-sim: %s: %s", what, qPrintable(hint));
        };
        // The one command installs what is missing (./phoenix at the top
        // of the checkout).
        const QString setup = QStringLiteral("./phoenix");
        // Dictation runs the transcriber (apps/voicememos/service/
        // transcribe-cli.js) with Node.js, which finds whisper-cli and its
        // model as on a device: PHOENIX_WHISPER_CLI or the PATH, and
        // PHOENIX_WHISPER_MODEL, here build/whisper's model when that is
        // not set (tools/get-whisper-model.py).
        QString whisper = qEnvironmentVariable("PHOENIX_WHISPER_CLI");
        for (const char *name : { "whisper-cli", "whisper-cpp" })
            if (whisper.isEmpty())
                whisper = QStandardPaths::findExecutable(QLatin1String(name));
        QString whisperModel = qEnvironmentVariable("PHOENIX_WHISPER_MODEL");
        if (whisperModel.isEmpty()) {
            whisperModel = here.filePath(QStringLiteral("whisper/ggml-base.en.bin"));
            if (QFileInfo::exists(whisperModel))
                qputenv("PHOENIX_WHISPER_MODEL", QFile::encodeName(whisperModel));
            else if (QFileInfo::exists(QStringLiteral("/usr/share/whisper/ggml-base.en.bin")))
                whisperModel = QStringLiteral("/usr/share/whisper/ggml-base.en.bin");
        }
        const bool node = !QStandardPaths::findExecutable(QStringLiteral("node")).isEmpty();
#ifdef Q_OS_MACOS
        const QString getWhisper = QStringLiteral("brew install whisper-cpp (%1 does it)").arg(setup);
#else
        const QString getWhisper = QStringLiteral("%1 builds it (or set PHOENIX_WHISPER_CLI)").arg(setup);
#endif
        part("recognition", "speech recognition", node && !whisper.isEmpty() && QFileInfo::exists(whisperModel), QStringLiteral("whisper.cpp"),
             !node ? QStringLiteral("Node.js is not on the PATH (%1 installs it).").arg(setup)
             : whisper.isEmpty() ? QStringLiteral("whisper.cpp's whisper-cli is missing; %1.").arg(getWhisper)
             : QStringLiteral("its model is missing; run tools/get-whisper-model.py (or set PHOENIX_WHISPER_MODEL)."));
        part("wakeWord", "the wake word", !wakeCommand.isEmpty(), QStringLiteral("Vosk"),
             !QFileInfo::exists(spotter) ? QStringLiteral("phoenix-wakeword is missing; it is built with phoenix-sim.")
             : QStringLiteral("Vosk and its model are missing; run tools/get-wakeword.py, then start phoenix-sim again "
                              "(or pass --wake-model and --vosk-library)."));
        // The program shell/native/speech.cpp would run (the runtime asks it
        // whether there is one; this is for the hint).
        QString speaker;
        if (parser.isSet(speechCommandOpt)) {
            const QString p = QProcess::splitCommand(parser.value(speechCommandOpt)).value(0);
            if (QFileInfo(p).isAbsolute() ? QFileInfo(p).isExecutable() : !QStandardPaths::findExecutable(p).isEmpty())
                speaker = QFileInfo(p).fileName();
        } else {
            // Kitten TTS first (phoenix-tts beside this program, with its
            // model in build/kitten: tools/get-kitten.py), as Speech does.
            QString kittenWhy;
            const QString tts = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("phoenix-tts"));
            if (QFileInfo(tts).isExecutable()) {
                QProcess check;
                check.start(tts, { QStringLiteral("--check") });
                check.waitForFinished(5000);
                const QJsonObject r = QJsonDocument::fromJson(check.readAllStandardOutput()).object();
                if (r.value(QStringLiteral("ok")).toBool())
                    speaker = QStringLiteral("Kitten TTS");
                else
                    kittenWhy = r.value(QStringLiteral("error")).toString();
            }
            for (const char *name : { "espeak-ng", "say", "flite" })
                if (speaker.isEmpty() && !QStandardPaths::findExecutable(QLatin1String(name)).isEmpty())
                    speaker = QLatin1String(name);
            if (!kittenWhy.isEmpty())
                qInfo("phoenix-sim: the voice: Kitten TTS cannot speak (%s); run tools/get-kitten.py (%s does it)%s",
                      qPrintable(kittenWhy), qPrintable(setup), speaker.isEmpty() ? "" : qPrintable(QStringLiteral(", %1 speaks meanwhile").arg(speaker)));
        }
        part("speech", "spoken answers", !speaker.isEmpty(), speaker,
             parser.isSet(speechCommandOpt) ? QStringLiteral("the --speech-command program was not found.")
             : QStringLiteral("no speech program; run tools/get-kitten.py for Kitten TTS (%1 does it), or sudo apt install espeak-ng, or start phoenix-sim with --speech-command.").arg(setup));
        hostInfo.insert(QStringLiteral("voice"), voice);
        if (!parser.isSet(llamaServerOpt) && QStandardPaths::findExecutable(QStringLiteral("llama-server")).isEmpty())
#ifdef Q_OS_MACOS
            qInfo("phoenix-sim: on-device models: llama.cpp's llama-server is missing; brew install llama.cpp (./phoenix does it), or --llama-server");
#else
            qInfo("phoenix-sim: on-device models: llama.cpp's llama-server is missing; ./phoenix builds it, or --llama-server");
#endif
    }
    rootfs.setHostInfo(QJsonDocument(hostInfo).toJson(QJsonDocument::Compact));
    // The Assistant's on-device models (downloaded into the simulator's data)
    // and its speech: the shell runs them, as "assistant" host messages ask
    // (the runtime's block "The Assistant").
    view.rootContext()->setContextProperty(QStringLiteral("simModelsDir"),
        QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).filePath(QStringLiteral("models")));
    view.rootContext()->setContextProperty(QStringLiteral("simLlamaServer"),
        parser.isSet(llamaServerOpt) ? QStringList{ parser.value(llamaServerOpt) } : QStringList());
    view.rootContext()->setContextProperty(QStringLiteral("simSpeechCommand"),
        parser.isSet(speechCommandOpt) ? QProcess::splitCommand(parser.value(speechCommandOpt)) : QStringList());
    view.rootContext()->setContextProperty(QStringLiteral("simSettings"), &settings);
#ifdef PHOENIX_HAVE_WEBENGINE
    view.rootContext()->setContextProperty(QStringLiteral("simMarketplace"), marketplace.get());
#else
    view.rootContext()->setContextProperty(QStringLiteral("simMarketplace"), nullptr);
#endif
    view.rootContext()->setContextProperty(QStringLiteral("simPty"), simPty);
    view.rootContext()->setContextProperty(QStringLiteral("simInstaller"), rootfs.isValid() ? &installer : nullptr);
    view.rootContext()->setContextProperty(QStringLiteral("simSnapshots"), rootfs.isValid() ? &snapshots : nullptr);
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
    const bool watched = !parser.isSet(shotOpt) && platform != QLatin1String("offscreen") && platform != QLatin1String("minimal");
    view.rootContext()->setContextProperty(QStringLiteral("simBootSounds"), !parser.isSet(quietOpt) && watched);
    // The boot animation: when someone is there to see it, or asked for.
    view.rootContext()->setContextProperty(QStringLiteral("simBootAnimation"),
        !parser.isSet(noBootAnimOpt) && (watched || parser.isSet(bootAnimOpt)));
    view.rootContext()->setContextProperty(QStringLiteral("simUpdating"), parser.isSet(updatingOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simSecurityPolicy"), securityPolicy);
    view.rootContext()->setContextProperty(QStringLiteral("simUsb"), parser.isSet(usbOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simUsbBusy"), parser.isSet(usbBusyOpt));
    view.rootContext()->setContextProperty(QStringLiteral("simTouchToShare"), parser.isSet(touchToShareOpt));
    // Qt.quit() (after the shutdown sound).
    QObject::connect(view.engine(), &QQmlEngine::quit, &app, &QCoreApplication::quit, Qt::QueuedConnection);
    view.rootContext()->setContextProperty(QStringLiteral("simFormFactor"),
        tablet ? QStringLiteral("tablet") : parser.isSet(phoneOpt) ? QStringLiteral("phone") : QStringLiteral("auto"));
    view.setResizeMode(QQuickView::SizeRootObjectToView);
    view.resize(size);
    view.setTitle(SimChrome::displayName());
    // The window with the menus and the toolbar, around the screen; not
    // on the offscreen platforms, where no one sees it.
    SimChrome *chrome = platform != QLatin1String("offscreen") && platform != QLatin1String("minimal")
        ? new SimChrome(&view, !parser.isSet(noToolbarOpt)) : nullptr;
    // The chrome's window container owns the view it shows: give the view
    // back (QWindow::setParent, as QWidget::createWindowContainer says) and
    // close the chrome before the view, a local, goes. Left to
    // QApplication's destructor, the container reaches for the view after
    // it is gone (Qt 6.11 crashes on quitting).
    const auto closeChrome = qScopeGuard([&view, chrome]() {
        if (!chrome)
            return;
        view.setParent(static_cast<QWindow *>(nullptr));
        delete chrome;
    });
    view.rootContext()->setContextProperty(QStringLiteral("simChrome"), chrome);
    view.setSource(QUrl::fromLocalFile(QDir(qmlDir).filePath(QStringLiteral("sim.qml"))));
    if (view.status() != QQuickView::Ready)
        return 1;
    if (chrome) {
        chrome->build();
        chrome->showWithScreen(size);
    } else {
        view.show();
    }

    if (parser.isSet(checkChromeOpt)) {
        if (!chrome) {
            std::fprintf(stderr, "phoenix-sim: --check-chrome: no menu bar on the %s platform\n", qPrintable(platform));
            return 1;
        }
        // Once the window is up and the app activated.
        QTimer::singleShot(3000, chrome, [chrome]() { QCoreApplication::exit(chrome->checkChrome() ? 0 : 1); });
    }

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
