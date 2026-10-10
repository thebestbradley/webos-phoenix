// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// siminstaller-test: phoenix-sim's installed apps (SimInstaller, Rootfs)
// against this checkout's rootfs: install, serve, list, replace, remove,
// and the installs that must be refused. tools/serve-rootfs.py does the
// same for the browser tests (tools/test-marketplace.cjs).
//
//   build/siminstaller-test

#include "rootfs.h"
#include "siminstaller.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QRegularExpression>
#include <QTemporaryDir>
#include <cstdio>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

static QVariantMap file(const QString &path, const QByteArray &data)
{
    return { { QStringLiteral("path"), path }, { QStringLiteral("data"), QString::fromLatin1(data.toBase64()) } };
}

static QVariantMap entry(const Rootfs &rootfs, const QString &id)
{
    for (const QVariant &v : rootfs.apps())
        if (v.toMap().value(QStringLiteral("id")) == id)
            return v.toMap();
    return {};
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    Rootfs rootfs(QStringLiteral(PHOENIX_REPO_DIR));
    check(rootfs.isValid(), "the checkout's rootfs loads");
    check(rootfs.missing().isEmpty(), qPrintable(QStringLiteral("nothing it names is missing (%1)").arg(rootfs.missing().join(QStringLiteral(", ")))));
    {
        // A checkout without its submodules: their folders are there, empty.
        QTemporaryDir repo;
        QDir(repo.path()).mkpath(QStringLiteral("runtime"));
        QDir(repo.path()).mkpath(QStringLiteral("third_party/core-apps"));
        QDir(repo.path()).mkpath(QStringLiteral("third_party/enyo-2/enyo"));
        QDir(repo.path()).mkpath(QStringLiteral("third_party/isis/isis-browser"));
        QDir(repo.path()).mkpath(QStringLiteral("apps/a"));
        QFile app(repo.filePath(QStringLiteral("apps/a/appinfo.json")));
        app.open(QIODevice::WriteOnly);
        app.close();
        QFile cfg(repo.filePath(QStringLiteral("runtime/rootfs.json")));
        cfg.open(QIODevice::WriteOnly);
        cfg.write(R"({"mounts": {"/usr/palm/frameworks/enyo2/enyo/": "third_party/enyo-2/enyo/",
                                 "/usr/palm/frameworks/mojoloader.js": "third_party/mojoloader/mojoloader.js",
                                 "/usr/share/phoenix/runtime/": "runtime/"},
                      "applicationDirs": ["third_party/core-apps", "third_party/isis", "apps"]})");
        cfg.close();
        const Rootfs bare(repo.path());
        check(bare.isValid() && bare.missing() == QStringList({ QStringLiteral("third_party/core-apps"), QStringLiteral("third_party/enyo-2"),
                                                                 QStringLiteral("third_party/isis"), QStringLiteral("third_party/mojoloader") }),
              qPrintable(QStringLiteral("without the submodules, they are missing (%1)").arg(bare.missing().join(QStringLiteral(", ")))));
    }
    QTemporaryDir dir;
    rootfs.setInstalledDir(dir.path());
    SimInstaller installer(&rootfs);
    const int builtIn = rootfs.apps().size();

    // The Open webOS apps' 512 px icons sit in the compat overlay, not
    // beside their icons in the submodules: they are the large icon.
    check(entry(rootfs, QStringLiteral("com.palm.app.calculator")).value(QStringLiteral("largeIcon")).toString()
              .endsWith(QStringLiteral("compat/rootfs/usr/palm/applications/com.palm.app.calculator/icon-512x512.png")),
          "a core app's large icon is the overlay's 512 px one");
    check(entry(rootfs, QStringLiteral("com.palm.app.calendar")).value(QStringLiteral("largeIcon")).toString()
              .endsWith(QStringLiteral("com.palm.app.calendar/images/icon-512x512.png")),
          "... found beside an icon in a subfolder too");
    check(entry(rootfs, QStringLiteral("org.webosphoenix.phone")).value(QStringLiteral("largeIcon")).toString()
              .endsWith(QStringLiteral("icon-256x256.png")),
          "a Phoenix app's large icon is still its splashicon");
    // The HiDPI variants of a core app's pictures sit in the overlay at the
    // app's device path: the shell finds them there (HiDpi twin directories).
    bool twin = false;
    for (const auto &p : rootfs.twinDirectories())
        twin = twin || (p.first.endsWith(QStringLiteral("third_party/core-apps/com.palm.app.email"))
                        && p.second.endsWith(QStringLiteral("compat/rootfs/usr/palm/applications/com.palm.app.email")));
    check(twin, "an app's directory is paired with the overlay's at its device path");

    const QString id = QStringLiteral("org.example.hello");
    const QByteArray info = R"({"id": "org.example.hello", "title": "Hello", "version": "1.0.0", "main": "index.html"})";
    QString err = installer.install(id, { file(QStringLiteral("appinfo.json"), info), file(QStringLiteral("index.html"), "<h1>1</h1>"),
                                          file(QStringLiteral("images/icon.png"), "png") });
    check(err.isEmpty(), "install");
    const QVariantMap e = entry(rootfs, id);
    check(e.value(QStringLiteral("installed")).toBool() && e.value(QStringLiteral("main")).toString() == QStringLiteral("phoenix://rootfs/usr/palm/applications/org.example.hello/index.html"),
          "it is listed, installed (removable), served at its device path");
    check(rootfs.apps().size() == builtIn + 1 && rootfs.launchPointsJson().contains("\"removable\":true"), "... once, and the pages' list says removable");
    QFile served(rootfs.resolve(QStringLiteral("/usr/palm/applications/org.example.hello/images/icon.png")));
    check(served.open(QIODevice::ReadOnly) && served.readAll() == "png", "its files resolve");

    err = installer.install(id, { file(QStringLiteral("appinfo.json"), QByteArray(info).replace("1.0.0", "1.1.0")), file(QStringLiteral("index.html"), "<h1>2</h1>") });
    QFile again(rootfs.resolve(QStringLiteral("/usr/palm/applications/org.example.hello/index.html")));
    check(err.isEmpty() && again.open(QIODevice::ReadOnly) && again.readAll() == "<h1>2</h1>"
          && !QFile::exists(rootfs.resolve(QStringLiteral("/usr/palm/applications/org.example.hello/images/icon.png")))
          && !QDir(dir.path() + QStringLiteral("/usr/palm/applications/org.example.hello.old")).exists(),
          "installing again replaces it whole");

    check(!installer.install(QStringLiteral("org.webosphoenix.settings"),
                             { file(QStringLiteral("appinfo.json"), R"({"id": "org.webosphoenix.settings"})") }).isEmpty()
          && entry(rootfs, QStringLiteral("org.webosphoenix.settings")).value(QStringLiteral("installed")).toBool() == false,
          "a built-in app's id is refused");
    check(!installer.install(QStringLiteral("org.example.evil"), { file(QStringLiteral("appinfo.json"), R"({"id": "org.example.evil"})"),
                                                                    file(QStringLiteral("../../../../escape.txt"), "x") }).isEmpty()
          && !QFile::exists(dir.path() + QStringLiteral("/escape.txt")) && entry(rootfs, QStringLiteral("org.example.evil")).isEmpty(),
          "a file outside the app is refused, and nothing is installed");
    check(!installer.install(QStringLiteral("org.example.a"), { file(QStringLiteral("appinfo.json"), R"({"id": "org.example.b"})") }).isEmpty(),
          "appinfo.json must say the same id");
    check(!installer.install(QStringLiteral("../x"), { file(QStringLiteral("appinfo.json"), "{}") }).isEmpty(), "a bad id is refused");
    check(!installer.install(QStringLiteral("org.example.c"), { file(QStringLiteral("index.html"), "x") }).isEmpty(), "an app needs appinfo.json");

    check(installer.remove(id).isEmpty() && entry(rootfs, id).isEmpty() && rootfs.apps().size() == builtIn, "remove");
    check(!installer.remove(QStringLiteral("org.webosphoenix.settings")).isEmpty() && !entry(rootfs, QStringLiteral("org.webosphoenix.settings")).isEmpty(),
          "built-in apps cannot be removed");

    // Launch points an app adds (applicationManager/addLaunchPoint): kept in
    // /var/luna/launchpoints/<id> under the data folder, listed for the
    // launcher (Favorites) and the pages, removed again.
    QTemporaryDir data;
    rootfs.setDataDir(data.path());
    rootfs.rescan();
    const QVariantMap added = installer.addLaunchPoint({ { QStringLiteral("id"), QStringLiteral("com.palm.app.browser") },
        { QStringLiteral("title"), QStringLiteral("Example") }, { QStringLiteral("icon"), QStringLiteral("/var/luna/data/browser/icons/icon64-1.png") },
        { QStringLiteral("params"), QVariantMap { { QStringLiteral("url"), QStringLiteral("https://example.com/") } } } });
    const QString lpId = added.value(QStringLiteral("launchPointId")).toString();
    check(QRegularExpression(QStringLiteral("^\\d{8}$")).match(lpId).hasMatch()
          && QFile::exists(data.path() + QStringLiteral("/var/luna/launchpoints/") + lpId), "addLaunchPoint: an eight-digit id, a file in /var/luna/launchpoints");
    const QVariantMap point = entry(rootfs, lpId);
    check(point.value(QStringLiteral("dynamic")).toBool() && point.value(QStringLiteral("page")).toString() == QStringLiteral("favorites")
          && point.value(QStringLiteral("appId")).toString() == QStringLiteral("com.palm.app.browser")
          && point.value(QStringLiteral("main")).toString().contains(QStringLiteral("launchParams=%7B%22url%22")),
          "it is a launcher entry on Favorites that opens the browser with its params");
    check(point.value(QStringLiteral("icon")).toString() == entry(rootfs, QStringLiteral("com.palm.app.browser")).value(QStringLiteral("icon")).toString(),
          "an icon not made yet: the app's");
    check(rootfs.launchPointsJson().contains(("\"launchPointId\":\"" + lpId + "\"").toUtf8()), "the pages list it");
    check(rootfs.resolve(QStringLiteral("/var/luna/data/browser/icons/icon64-1.png")) == data.path() + QStringLiteral("/var/luna/data/browser/icons/icon64-1.png"),
          "/var/luna/ is in the data folder");
    check(installer.addLaunchPoint({ { QStringLiteral("id"), QStringLiteral("com.example.none") }, { QStringLiteral("title"), QStringLiteral("X") } })
              .value(QStringLiteral("error")).toString() == QStringLiteral("Unable to find id: com.example.none"), "an unknown app is refused");
    check(installer.removeLaunchPoint(QStringLiteral("com.palm.app.browser_default")).startsWith(QStringLiteral("launch point [")),
          "an app's own launch point cannot be removed");
    check(installer.removeLaunchPoint(lpId).isEmpty() && entry(rootfs, lpId).isEmpty(), "removeLaunchPoint");
    check(installer.freeSpaceKB() > 0, "free space where apps go");
    check(entry(rootfs, QStringLiteral("com.palm.app.browser")).value(QStringLiteral("size")).toLongLong() > 10000, "apps know their size");

    // The connector packages Phoenix comes with (rootfs.json "preinstalled": the Fediverse):
    // installed apps, put there for a new device, removable, and not put back once removed.
    {
        const QString fedi = QStringLiteral("org.webosphoenix.fediverse");
        check(rootfs.preinstalledIds().contains(fedi), "the Fediverse is a pre-installed package");
        QTemporaryDir fresh;
        Rootfs device(QStringLiteral(PHOENIX_REPO_DIR));
        check(!device.hasApp(fedi), "... not a built-in app");
        device.setInstalledDir(fresh.path());
        SimInstaller inst(&device);
        const QString markers = fresh.path() + QStringLiteral("/var/lib/phoenix/preinstalled/");
        check(device.isInstalled(fedi) && QFile::exists(fresh.path() + QStringLiteral("/usr/palm/applications/") + fedi + QStringLiteral("/service/connector.js"))
              && QFile::exists(markers + fedi + QStringLiteral(".offered")) && QFile::exists(markers + fedi + QStringLiteral(".seeded")),
              "a new device has it among the installed apps, with its service");
        check(entry(device, fedi).value(QStringLiteral("installed")).toBool(), "... removable");
        check(inst.remove(fedi).isEmpty() && !device.isInstalled(fedi) && !QFile::exists(markers + fedi + QStringLiteral(".seeded")), "removed like any installed app");
        Rootfs again(QStringLiteral(PHOENIX_REPO_DIR));
        again.setInstalledDir(fresh.path());
        check(!again.isInstalled(fedi), "once removed it is not put back at the next start");
        // Installed again (from the catalog): the user's copy, not refreshed from the checkout.
        SimInstaller inst2(&again);
        check(inst2.install(fedi, { file(QStringLiteral("appinfo.json"), "{\"id\": \"org.webosphoenix.fediverse\", \"version\": \"9.9.9\"}") }).isEmpty()
              && again.isInstalled(fedi), "installed again");
        Rootfs third(QStringLiteral(PHOENIX_REPO_DIR));
        third.setInstalledDir(fresh.path());
        QFile info(fresh.path() + QStringLiteral("/usr/palm/applications/") + fedi + QStringLiteral("/appinfo.json"));
        check(info.open(QIODevice::ReadOnly) && info.readAll().contains("9.9.9"), "... and kept as installed, not replaced by the checkout's copy");
    }
    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
