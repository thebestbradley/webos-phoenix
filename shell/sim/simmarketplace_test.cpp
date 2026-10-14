// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simmarketplace-test: phoenix-sim's catalog service (SimMarketplace)
// started without blocking, stopped, found running, and failing, against a
// stand-in checkout whose bin/serve.sh is a small script and a PATH with a
// stand-in php: no PHP needed. PHP's server is this program itself
// (simmarketplace-test --serve PORT: it listens, nothing else), so the test
// depends on no other program: a python3 run from the stand-in PATH did
// not answer on macOS (CI), where the system's python3 is a launcher that
// finds the real one by its own location and the PATH.
//
// Then the one catalog every simulator shares (docs/APP-STORE.md 3.16),
// with the checkout's real bin/serve.sh and the stand-in php: simulators
// are this program too (--simulator: a SimInstances entry and a
// SimMarketplace, its states on stdout, "stop" on stdin), so the catalog's
// lifetime is tried across processes: the first one starts it (importing a
// checkout's old catalog into the shared folder), a second uses it, the
// first quitting leaves it to the second, the second crashing stops it
// within the watch's grace, one killed under a simulator is started again,
// one stopped from the menu stays stopped, and one an older simulator runs
// (no server.json) is used as it is.
//
//   build/simmarketplace-test
//
// SIMMARKETPLACE_TEST_KEEP=1 keeps its folders (and what the catalog said
// and the processes when a stop fails), with times; SIMMARKETPLACE_TEST_TRACE=1
// runs the shared catalog's serve.sh with set -x.

#include "siminstances.h"
#include "simmarketplace.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QStandardPaths>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimer>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <thread>

#include <unistd.h>

static int failures = 0;
static std::atomic<int> checks{ 0 };
static QElapsedTimer since;
static void check(bool ok, const char *what)
{
    ++checks;
    if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP"))
        std::printf("[%6lld] ", since.elapsed());
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    std::fflush(stdout);
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

// Something listens on the port. A look that times out (seen here now and
// then while the stand-in server is busy) is tried again.
static bool answers(quint16 port)
{
    for (int i = 0; i < 3; ++i) {
        QTcpSocket socket;
        socket.connectToHost(QHostAddress(QHostAddress::LocalHost), port);
        if (socket.waitForConnected(500))
            return true;
        if (socket.error() != QAbstractSocket::SocketTimeoutError)
            return false;
    }
    return false;
}

// Nothing listens on the port: the connection is refused (not merely slow).
static bool refused(quint16 port)
{
    QTcpSocket socket;
    socket.connectToHost(QHostAddress(QHostAddress::LocalHost), port);
    if (socket.waitForConnected(1000))
        return false;
    if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP") && socket.error() != QAbstractSocket::ConnectionRefusedError)
        std::printf("  (port %d: %s)\n", port, qPrintable(socket.errorString()));
    return socket.error() == QAbstractSocket::ConnectionRefusedError;
}

// Runs the event loop until cond() or timeoutMs.
template <typename F>
static bool waitFor(F cond, int timeoutMs)
{
    QElapsedTimer t;
    t.start();
    bool ok = cond();
    while (!ok && t.elapsed() < timeoutMs) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 50);
        ok = cond();
    }
    return ok;
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

static QByteArray readAll(const QString &path)
{
    QFile f(path);
    return f.open(QIODevice::ReadOnly) ? f.readAll() : QByteArray();
}

static std::atomic<bool> terminated{ false };
static SimMarketplace *g_sim = nullptr;

// A simulator, as far as the catalog goes: listed in the simulators'
// folder, wanting the catalog, saying each state ("state running here"),
// stopping it on "stop"; SIGTERM quits it as a simulator quits (its
// destructors run), SIGKILL is a crash.
static int simulator(QCoreApplication &app, const QString &repo, quint16 port, const QString &instancesDir, const QString &name)
{
    std::signal(SIGTERM, [](int) { terminated = true; });
    SimInstances instances(instancesDir, name);
    instances.start({});
    SimMarketplace m(repo, port);
    m.setInstancesDir(instancesDir);
    QObject::connect(&m, &SimMarketplace::stateChanged, [&m]() {
        std::printf("state %s %s\n", qPrintable(m.stateName()), qPrintable(m.origin()));
        std::fflush(stdout);
    });
    QTimer poll;
    QObject::connect(&poll, &QTimer::timeout, [&app]() {
        if (terminated)
            app.quit();
    });
    poll.start(50);
    // "stop" on stdin: Services > Marketplace Catalog, unchecked. Read
    // with read(2), not stdio: a thread blocked in fgets holds stdin's lock,
    // which exit() takes to flush the streams, and the process would never
    // end.
    g_sim = &m;
    std::thread([]() {
        char c;
        QByteArray line;
        while (::read(0, &c, 1) == 1) {
            if (c != '\n') {
                line += c;
                continue;
            }
            if (line == "stop")
                QMetaObject::invokeMethod(QCoreApplication::instance(), []() { if (g_sim) g_sim->stop(); }, Qt::QueuedConnection);
            line.clear();
        }
    }).detach();
    QTimer::singleShot(120000, &app, &QCoreApplication::quit);
    m.startAsync(20000);
    const int code = app.exec();
    g_sim = nullptr;
    return code;
}

// One of those simulators, run from the test: its states as they come.
struct Sim {
    QProcess p;
    QByteArray out;
    void start(const QString &repo, quint16 port, const QString &instancesDir, const QString &name)
    {
        p.setProcessChannelMode(QProcess::ForwardedErrorChannel);
        QObject::connect(&p, &QProcess::readyReadStandardOutput, [this]() { out += p.readAllStandardOutput(); });
        p.start(QCoreApplication::applicationFilePath(),
                { QStringLiteral("--simulator"), repo, QString::number(port), instancesDir, name });
    }
    // Waits for a state line said after the ones seen so far.
    bool said(const QByteArray &line, int timeoutMs, int *from = nullptr)
    {
        int start = from ? *from : 0;
        const bool ok = waitFor([&] { return out.indexOf(line + '\n', start) >= 0; }, timeoutMs);
        if (ok && from)
            *from = out.indexOf(line + '\n', start) + line.size() + 1;
        return ok;
    }
    // True once it has ended.
    bool quit()
    {
        ::kill(static_cast<pid_t>(p.processId()), SIGTERM);
        return waitFor([&] { return p.state() == QProcess::NotRunning; }, 10000);
    }
    void crash()
    {
        p.kill();
        waitFor([&] { return p.state() == QProcess::NotRunning; }, 5000);
    }
    ~Sim()
    {
        if (p.state() != QProcess::NotRunning)
            crash();
    }
};

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    // The stand-in for PHP's server: listens on the port until stopped
    // (SIGTERM, which it leaves to its default: it ends). Without Linux's
    // parent-death signal (a Mac) it also ends when its parent does, or
    // after a minute: nothing is left behind.
    if (argc == 3 && qstrcmp(argv[1], "--serve") == 0) {
        QTcpServer server;
        if (!server.listen(QHostAddress::LocalHost, quint16(QByteArray(argv[2]).toUInt())))
            return 2;
        // Each connection (the simulators' and the test's looks) is closed
        // at once: kept, they would fill QTcpServer's pending ones (30), it
        // would stop taking more, and a look would wait and fail.
        QObject::connect(&server, &QTcpServer::newConnection, [&server]() {
            while (QTcpSocket *c = server.nextPendingConnection()) {
                c->close();
                c->deleteLater();
            }
        });
        std::printf("listening\n");
        std::fflush(stdout);
        const pid_t parent = ::getppid();
        QTimer orphaned;
        QObject::connect(&orphaned, &QTimer::timeout, [parent]() {
            if (::getppid() != parent)
                ::_exit(0);
        });
        orphaned.start(250);
        QTimer::singleShot(60000, [] { ::_exit(0); });
        return app.exec();
    }
    if (argc == 6 && qstrcmp(argv[1], "--simulator") == 0)
        return simulator(app, QString::fromLocal8Bit(argv[2]), quint16(QByteArray(argv[3]).toUInt()),
                         QString::fromLocal8Bit(argv[4]), QString::fromLocal8Bit(argv[5]));
    // Whatever happens, the test ends: a stuck wait fails it after four
    // minutes (it takes about a minute), saying where.
    std::thread([] {
        std::this_thread::sleep_for(std::chrono::seconds(240));
        std::fprintf(stderr, "FAIL simmarketplace-test is stuck (after %d checks); stopped by its watchdog\n", checks.load());
        ::_exit(3);
    }).detach();
    qputenv("FAKE_CATALOG_SERVER", QFile::encodeName(QCoreApplication::applicationFilePath()));
    since.start();
    QTemporaryDir root;
    // SIMMARKETPLACE_TEST_KEEP=1: its folders are kept, to look at the logs.
    if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP")) {
        root.setAutoRemove(false);
        std::printf("kept: %s\n", qPrintable(root.path()));
    }
    // The catalog's folder: the shared one, here the test's own.
    const QString folder = root.filePath(QStringLiteral("catalog"));
    qputenv("MARKETPLACE_DATA", QFile::encodeName(folder));
    check(SimMarketplace::defaultFolder() == folder, "MARKETPLACE_DATA names the catalog's folder");
    {
        qunsetenv("MARKETPLACE_DATA");
        const QByteArray home = qgetenv("HOME"), xdg = qgetenv("XDG_DATA_HOME");
        qputenv("HOME", "/home/someone");
        qputenv("XDG_DATA_HOME", "");
#ifdef Q_OS_MACOS
        check(SimMarketplace::defaultFolder() == QStringLiteral("/home/someone/Library/Application Support/Phoenix/catalog"),
              "else the user's: ~/Library/Application Support/Phoenix/catalog");
#else
        check(SimMarketplace::defaultFolder() == QStringLiteral("/home/someone/.local/share/phoenix/catalog"),
              "else the user's: ~/.local/share/phoenix/catalog");
        qputenv("XDG_DATA_HOME", "/data/someone");
        check(SimMarketplace::defaultFolder() == QStringLiteral("/data/someone/phoenix/catalog"), "... or $XDG_DATA_HOME/phoenix/catalog");
#endif
        qputenv("HOME", home);
        if (xdg.isNull())
            qunsetenv("XDG_DATA_HOME");
        else
            qputenv("XDG_DATA_HOME", xdg);
        qputenv("MARKETPLACE_DATA", QFile::encodeName(folder));
    }
    // A PATH with php (a stand-in); and one without php.
    const QString bin = root.filePath(QStringLiteral("bin"));
    const QString noPhp = root.filePath(QStringLiteral("bin-no-php"));
    write(bin + QStringLiteral("/php"), "#!/bin/sh\nexit 0\n", true);
    QDir().mkpath(noPhp);
    // And what serve.sh runs besides.
    for (const char *name : { "sh", "cat", "sleep", "dirname", "uname", "mkdir", "cp", "rm", "mv", "sed", "date", "ps" }) {
        const QString real = QStandardPaths::findExecutable(QLatin1String(name));
        QFile::link(real, bin + QLatin1Char('/') + QLatin1String(name));
        QFile::link(real, noPhp + QLatin1Char('/') + QLatin1String(name));
    }
    qputenv("PATH", QFile::encodeName(bin));

    // A checkout whose serve.sh sets itself up (a signing key) the first
    // time, then serves; MODE picks how it misbehaves.
    const QString repo = root.filePath(QStringLiteral("repo"));
    write(repo + QStringLiteral("/server/marketplace/bin/serve.sh"),
          "#!/bin/sh\n"
          "cd \"$(dirname \"$0\")/..\"\n"
          "case \"$(cat \"$MARKETPLACE_DATA/mode\" 2>/dev/null)\" in\n"
          "  fail) echo 'PHP Fatal error: no sodium' >&2; exit 3 ;;\n"
          "  silent) exec sleep 60 ;;\n"
          "esac\n"
          "[ -f \"$MARKETPLACE_DATA/signing.key\" ] || { sleep 0.3; echo key > \"$MARKETPLACE_DATA/signing.key\"; }\n"
          "echo \"serving on $1, base $MARKETPLACE_BASE_URL\"\n"
          "exec \"$FAKE_CATALOG_SERVER\" --serve \"$1\"\n",
          true);
    const auto mode = [&](const QByteArray &m) { write(folder + QStringLiteral("/mode"), m); };
    QDir().mkpath(folder);

    {
        // Started without blocking: starting (setting up), then running.
        const quint16 port = freePort();
        SimMarketplace m(repo, port);
        check(m.stateName() == QLatin1String("stopped") && m.url() == QStringLiteral("http://127.0.0.1:%1/").arg(port), "stopped at first");
        check(m.folder() == folder && m.logFile() == folder + QStringLiteral("/simulator.log"), "its folder and its log there");
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
        check(m.ownsServer() && m.origin() == QLatin1String("here") && !m.settingUp() && m.error().isEmpty() && answers(port),
              "it is this simulator's, and answers");
        check(readAll(m.logFile()).contains(QStringLiteral("base http://127.0.0.1:%1/v1/").arg(port).toUtf8()),
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
        check(waitFor([&] { return refused(port); }, 3000), "and the server is gone");
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
        check(waitFor([&] { return refused(port); }, 3000), "gone with the simulator");
    }
    {
        // The service fails: failed, with the log's last lines.
        mode("fail");
        SimMarketplace m(repo, freePort());
        m.startAsync(20000);
        check(waitFor([&] { return m.state() == SimMarketplace::Failed; }, 10000), "a service that exits: failed");
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

    // ---- The catalog every simulator shares (the checkout's own serve.sh) ----
    const QString shared = root.filePath(QStringLiteral("shared"));
    const QString sharedFolder = shared + QStringLiteral("/catalog");
    const QString instancesDir = shared + QStringLiteral("/instances");
    qputenv("MARKETPLACE_DATA", QFile::encodeName(sharedFolder));
    // The watch stops the catalog 2 s after the last simulator is gone.
    qputenv("PHOENIX_CATALOG_GRACE", "2");
    // A checkout with the real serve.sh, and an old catalog of its own to import.
    const QString repo2 = shared + QStringLiteral("/checkout");
    const QByteArray serveSh = readAll(QStringLiteral(PHOENIX_REPO_DIR "/server/marketplace/bin/serve.sh"));
    check(serveSh.contains("--watch"), "the checkout's bin/serve.sh");
    write(repo2 + QStringLiteral("/server/marketplace/bin/serve.sh"),
          qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_TRACE") ? QByteArray(serveSh).replace("\nset -e\n", "\nset -ex\n") : serveSh, true);
    const QByteArray key = QByteArray(32, 'k').toBase64();
    write(repo2 + QStringLiteral("/server/marketplace/data/signing.key"), "old key\n");
    write(repo2 + QStringLiteral("/server/marketplace/data/public/v1/key.json"), "{\"key\": \"" + key + "\"}\n");
    write(repo2 + QStringLiteral("/server/marketplace/data/marketplace.sqlite"), "old apps");
    // PHP: its server is this program; the catalog's commands do nothing
    // (python3 and node are not on this PATH: the fill and the connectors
    // say so in the log).
    write(bin + QStringLiteral("/php"),
          "#!/bin/sh\n"
          "case \"$1\" in\n"
          "  -S) exec \"$FAKE_CATALOG_SERVER\" --serve \"${2##*:}\" ;;\n"
          "esac\n"
          "exit 0\n",
          true);
    const quint16 port = freePort();
    // SIMMARKETPLACE_TEST_KEEP: what the catalog said and the processes, kept with the folders.
    const auto dump = [&](const QString &name) {
        if (!qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP"))
            return;
        QProcess ps;
        ps.start(QStringLiteral("/bin/sh"), { QStringLiteral("-c"), QStringLiteral(
            "/usr/bin/ps -eo pid,ppid,stat,lstart,comm,args | /usr/bin/grep -v claude; for p in $(/usr/bin/ps -eo pid,comm | /usr/bin/awk '$2==\"sleep\"{print $1}'); do echo \"== $p\"; /usr/bin/cat /proc/$p/wchan; echo; /usr/bin/cat /proc/$p/syscall; /usr/bin/grep -E 'Sig|State' /proc/$p/status; /usr/bin/cat /proc/$p/cmdline | /usr/bin/tr '\\0' ' '; echo; done; date") });
        ps.waitForFinished();
        write(root.filePath(name + QStringLiteral(".log")), readAll(sharedFolder + QStringLiteral("/simulator.log")) + "\n--- server.json\n"
              + readAll(sharedFolder + QStringLiteral("/server.json")) + "\n--- ps\n" + ps.readAll());
    };
    {
        Sim a, b;
        a.start(repo2, port, instancesDir, QStringLiteral("a"));
        check(a.said("state running here", 20000), "the first simulator starts the shared catalog");
        check(readAll(sharedFolder + QStringLiteral("/signing.key")) == "old key\n"
              && readAll(sharedFolder + QStringLiteral("/marketplace.sqlite")) == "old apps",
              "the first start imports the checkout's old catalog, its key and its apps, into the shared folder");
        check(QFile::exists(repo2 + QStringLiteral("/server/marketplace/data/signing.key")), "... and leaves the old folder as it was");
        check(readAll(sharedFolder + QStringLiteral("/simulator.log")).contains("Imported the catalog of "), "... saying so in the log");
        const QJsonObject server = QJsonDocument::fromJson(readAll(sharedFolder + QStringLiteral("/server.json"))).object();
        check(server.value(QStringLiteral("port")).toInt() == port && server.value(QStringLiteral("pid")).toInteger() > 0,
              "server.json says it runs, its watch's process and its port");

        b.start(repo2, port, instancesDir, QStringLiteral("b"));
        check(b.said("state running shared", 10000), "a second simulator uses it: this folder's, started by another");
        // A crashed simulator's entry whose process id is now another program's (this test's): not counted.
        write(instancesDir + QStringLiteral("/phoenix-sim-ghost.json"),
              QStringLiteral("{\"exe\":\"phoenix-sim\",\"info\":{},\"name\":\"ghost\",\"pid\":%1,\"socket\":\"/nowhere\"}")
                  .arg(QCoreApplication::applicationPid()).toUtf8());

        check(a.quit() && a.p.exitStatus() == QProcess::NormalExit && a.p.exitCode() == 0, "the first simulator quits");
        QElapsedTimer t;
        t.start();
        waitFor([] { return false; }, 4000);
        check(answers(port) && b.p.state() == QProcess::Running, "the catalog goes on for the second one, past the watch's grace");
        check(!QFile::exists(instancesDir + QStringLiteral("/phoenix-sim-a.json")), "... the first one's entry gone");

        if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP"))
            std::printf("--- b said:\n%s--- log:\n%s---\n", b.out.constData(), readAll(sharedFolder + QStringLiteral("/simulator.log")).constData());
        b.crash();
        if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP"))
            std::printf("[%6lld] crashed b (%d)\n", since.elapsed(), int(b.p.state()));
        t.restart();
        check(waitFor([&] { return refused(port); }, 10000),
              qPrintable(QStringLiteral("the last one crashing: the catalog stops within the grace (%1 ms)").arg(t.elapsed())));
        if (answers(port))
            dump(QStringLiteral("crash"));
        check(waitFor([&] { return !QFile::exists(sharedFolder + QStringLiteral("/server.json")); }, 3000), "... and server.json goes");
        QFile::remove(instancesDir + QStringLiteral("/phoenix-sim-ghost.json"));
    }
    {
        // Killed under a simulator (not from the menu): started again.
        Sim c;
        c.start(repo2, port, instancesDir, QStringLiteral("c"));
        int at = 0;
        check(c.said("state running here", 20000, &at), "a simulator starts it again (set up already: no import)");
        const qint64 watch = QJsonDocument::fromJson(readAll(sharedFolder + QStringLiteral("/server.json"))).object()
                                 .value(QStringLiteral("pid")).toInteger();
        check(watch > 0 && ::kill(static_cast<pid_t>(watch), SIGTERM) == 0, "its watch is stopped (someone kills it)");
        check(c.said("state running here", 20000, &at) && answers(port), "the simulator finds it gone and starts it again");

        // Stopped from the menu: for every simulator, and not started again.
        c.p.write("stop\n");
        check(c.said("state stopped ", 5000, &at), "stopped from the menu");
        check(waitFor([&] { return refused(port); }, 5000), "... the server is gone");
        if (answers(port))
            dump(QStringLiteral("stop"));
        waitFor([] { return false; }, 4000);
        check(refused(port) && c.out.indexOf("state starting", at) < 0, "... and stays gone (the simulator does not start it again)");
        check(c.quit(), "the simulator quits");
    }
    {
        // One an older simulator runs (no server.json of this folder): used as it is, its key unknown.
        QTcpServer older;
        older.listen(QHostAddress::LocalHost, 0);
        SimMarketplace m(repo2, older.serverPort());
        m.setInstancesDir(instancesDir);
        check(m.start(3000) && m.origin() == QLatin1String("older") && !m.ownsServer(), "an older simulator's catalog: used as it is");
        check(m.key().isEmpty(), "... its key not taken from this folder (the user checks its fingerprint)");
        m.stop();
        check(m.state() == SimMarketplace::Running, "... and not stopped from here");

        // The fill's state, from fill/status.json as it changes.
        write(sharedFolder + QStringLiteral("/fill/status.json"),
              QStringLiteral("{\"state\":\"running\",\"pid\":%1,\"now\":\"web apps: KeeWeb (1 of 2)\",\"text\":\"\"}")
                  .arg(QCoreApplication::applicationPid()).toUtf8());
        check(waitFor([&] { return m.fillState() == QLatin1String("running"); }, 5000) && m.fillText() == QLatin1String("web apps: KeeWeb (1 of 2)"),
              "the fill's progress, as it goes");
        write(sharedFolder + QStringLiteral("/fill/status.json"),
              "{\"state\":\"offline\",\"pid\":1,\"finished\":\"2026-10-14T12:00:00Z\",\"text\":\"web apps: offline; the next start tries again\"}");
        check(waitFor([&] { return m.fillState() == QLatin1String("offline"); }, 5000) && m.fillText().contains(QLatin1String("next start"))
                  && m.fillFinished() == QLatin1String("2026-10-14T12:00:00Z"),
              "... and how it ended");
        write(sharedFolder + QStringLiteral("/fill/status.json"), "{\"state\":\"running\",\"pid\":999999999,\"now\":\"x\"}");
        check(waitFor([&] { return m.fillState() == QLatin1String("stopped"); }, 5000), "a fill that ended before it finished: stopped");
    }

    std::printf(failures ? "\n%d check(s) failed\n" : "\nAll checks passed.\n", failures);
    return failures ? 1 : 0;
}
