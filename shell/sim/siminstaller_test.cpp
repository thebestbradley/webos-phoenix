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
    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
