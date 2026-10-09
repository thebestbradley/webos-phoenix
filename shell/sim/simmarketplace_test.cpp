// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simmarketplace-test: phoenix-sim's catalog service (SimMarketplace)
// started without blocking, stopped, found running, and failing, against a
// stand-in checkout whose bin/serve.sh is a small script (Python's HTTP
// server for PHP's) and a PATH with a stand-in php: no PHP needed.
//
//   build/simmarketplace-test

#include "simmarketplace.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QHostAddress>
#include <QStandardPaths>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimer>
#include <cstdio>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

// A port nothing listens on.
static quint16 freePort()
{
    QTcpServer s;
    s.listen(QHostAddress::LocalHost, 0);
    return s.serverPort();
}

static bool answers(quint16 port)
{
    QTcpSocket socket;
    socket.connectToHost(QHostAddress(QHostAddress::LocalHost), port);
    return socket.waitForConnected(500);
}

// Runs the event loop until cond() or timeoutMs.
template <typename F>
static bool waitFor(F cond, int timeoutMs)
{
    QElapsedTimer t;
    t.start();
    while (!cond() && t.elapsed() < timeoutMs)
        QCoreApplication::processEvents(QEventLoop::AllEvents, 50);
    return cond();
}

static void write(const QString &path, const QByteArray &text, bool executable = false)
{
    QDir().mkpath(path.section(QLatin1Char('/'), 0, -2));
    QFile f(path);
    f.open(QIODevice::WriteOnly);
    f.write(text);
    f.close();
    if (executable)
        f.setPermissions(f.permissions() | QFile::ExeOwner | QFile::ExeUser);
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    const QString python = QStandardPaths::findExecutable(QStringLiteral("python3"));
    if (python.isEmpty()) {
        std::printf("FAIL python3 is needed for the stand-in server\n");
        return 1;
    }
    QTemporaryDir root;
    // A PATH with php (a stand-in) and python3; and one without php.
    const QString bin = root.filePath(QStringLiteral("bin"));
    const QString noPhp = root.filePath(QStringLiteral("bin-no-php"));
    write(bin + QStringLiteral("/php"), "#!/bin/sh\nexit 0\n", true);
    QDir().mkpath(noPhp);
    // And what serve.sh runs besides.
    for (const char *name : { "python3", "cat", "sleep", "dirname" }) {
        const QString real = QStandardPaths::findExecutable(QLatin1String(name));
        QFile::link(real, bin + QLatin1Char('/') + QLatin1String(name));
        QFile::link(real, noPhp + QLatin1Char('/') + QLatin1String(name));
    }
    qputenv("PATH", QFile::encodeName(bin));

    // A checkout whose serve.sh sets itself up (a signing key) the first
    // time, then serves; MODE picks how it misbehaves.
    const QString repo = root.filePath(QStringLiteral("repo"));
    const QString data = repo + QStringLiteral("/server/marketplace/data");
    write(repo + QStringLiteral("/server/marketplace/bin/serve.sh"),
          "#!/bin/sh\n"
          "cd \"$(dirname \"$0\")/..\"\n"
          "case \"$(cat data/mode 2>/dev/null)\" in\n"
          "  fail) echo 'PHP Fatal error: no sodium' >&2; exit 3 ;;\n"
          "  silent) exec sleep 60 ;;\n"
          "esac\n"
          "[ -f data/signing.key ] || { sleep 0.3; echo key > data/signing.key; }\n"
          "echo \"serving on $1, base $MARKETPLACE_BASE_URL\"\n"
          "exec python3 -m http.server \"$1\" --bind 127.0.0.1\n",
          true);
    const auto mode = [&](const QByteArray &m) { write(data + QStringLiteral("/mode"), m); };
    QDir().mkpath(data);

    {
        // Started without blocking: starting (setting up), then running.
        const quint16 port = freePort();
        SimMarketplace m(repo, port);
        check(m.stateName() == QLatin1String("stopped") && m.url() == QStringLiteral("http://127.0.0.1:%1/").arg(port), "stopped at first");
        QStringList states;
        bool settingUp = false;
        QObject::connect(&m, &SimMarketplace::stateChanged, [&]() {
            if (states.isEmpty() || states.last() != m.stateName())
                states << m.stateName();
            settingUp = settingUp || m.settingUp();
        });
        QElapsedTimer t;
        t.start();
        m.startAsync(20000);
        check(t.elapsed() < 500 && m.stateName() == QLatin1String("starting"), "startAsync returns at once, starting");
        check(waitFor([&] { return m.settingUp(); }, 3000), "the first time it says it is setting the catalog up");
        check(waitFor([&] { return m.state() == SimMarketplace::Running; }, 20000), "then running");
        check(states == QStringList({ QStringLiteral("starting"), QStringLiteral("running") }),
              qPrintable(QStringLiteral("stateChanged: starting, running (%1)").arg(states.join(QLatin1Char(',')))));
        check(m.ownsServer() && !m.settingUp() && m.error().isEmpty() && answers(port), "it is this simulator's, and answers");
        QFile log(m.logFile());
        check(log.open(QIODevice::ReadOnly) && log.readAll().contains(QStringLiteral("base http://127.0.0.1:%1/v1/").arg(port).toUtf8()),
              "its log, with the catalog's address given to it");

        // Another simulator: finds it running and uses it, not its own.
        SimMarketplace other(repo, port);
        other.startAsync(5000);
        check(waitFor([&] { return other.state() == SimMarketplace::Running; }, 5000) && !other.ownsServer(),
              "a second one finds it running and uses it");
        other.stop();
        check(other.state() == SimMarketplace::Running && answers(port), "stopping that one leaves the other's running");

        m.startAsync();
        check(m.state() == SimMarketplace::Running, "starting it again while it runs: nothing changes");
        m.stop();
        check(waitFor([&] { return m.state() == SimMarketplace::Stopped; }, 5000) && !m.ownsServer(), "stop: stopped");
        check(waitFor([&] { return !answers(port); }, 3000), "and the server is gone");
        check(states.last() == QLatin1String("stopped"), "stateChanged: stopped");

        // The second time: no setting up.
        settingUp = false;
        m.startAsync(20000);
        check(waitFor([&] { return m.state() == SimMarketplace::Running; }, 20000), "started again");
        check(!settingUp, "set up already: not again");
    }
    {
        // The blocking start (--marketplace), and the destructor stops it.
        const quint16 port = freePort();
        {
            SimMarketplace m(repo, port);
            check(m.start(20000) && m.ownsServer(), "start() waits until it runs");
        }
        check(waitFor([&] { return !answers(port); }, 3000), "gone with the simulator");
    }
    {
        // The service fails: failed, with the log's last lines.
        mode("fail");
        SimMarketplace m(repo, freePort());
        m.startAsync(20000);
        check(waitFor([&] { return m.state() == SimMarketplace::Failed; }, 10000), qPrintable("a service that exits: failed (" + m.stateName() + " " + m.error() + ")"));
        check(m.error().contains(QLatin1String("exit code 3")) && m.error().contains(QLatin1String("no sodium")),
              qPrintable(QStringLiteral("... saying why, from its log (%1)").arg(m.error())));
        m.stop();
        check(m.state() == SimMarketplace::Stopped && m.error().isEmpty(), "stop after failing: stopped, the reason gone");
    }
    {
        // It never answers: failed when the time is up, and stopped.
        mode("silent");
        SimMarketplace m(repo, freePort());
        check(!m.start(1500), "a service that never answers: start() gives up");
        check(m.state() == SimMarketplace::Failed && m.error().contains(QLatin1String("did not answer")), "... failed, saying so");
        check(waitFor([&] { return !m.ownsServer(); }, 5000), "... and its process is stopped");
        check(m.state() == SimMarketplace::Failed, "... still failed after it stops");
    }
    {
        // No PHP: failed at once, saying how to get it.
        mode("");
        qputenv("PATH", QFile::encodeName(noPhp));
        SimMarketplace m(repo, freePort());
        m.startAsync();
        check(waitFor([&] { return m.state() == SimMarketplace::Failed; }, 3000) && m.error().contains(QLatin1String("PHP 8")),
              "without PHP: failed, saying what to install");
        qputenv("PATH", QFile::encodeName(bin));
    }
    {
        // No catalog in the checkout.
        QTemporaryDir empty;
        SimMarketplace m(empty.path(), freePort());
        check(!m.start(3000) && m.error().contains(QLatin1String("serve.sh is missing")), "no server/marketplace: failed");
    }
    {
        // Anything already answering on the port is taken as the catalog.
        QTcpServer busy;
        busy.listen(QHostAddress::LocalHost, 0);
        SimMarketplace m(repo, busy.serverPort());
        check(m.start(3000) && !m.ownsServer(), "one already running (not this simulator's) is used");
    }

    std::printf(failures ? "\n%d check(s) failed\n" : "\nAll checks passed.\n", failures);
    return failures ? 1 : 0;
}
