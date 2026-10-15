// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simmarketplace-test: phoenix-sim's catalog service (SimMarketplace)
// started without blocking, stopped, found running, and failing, against a
// stand-in checkout whose bin/serve.sh is a small script and a PATH with a
// stand-in php: no PHP needed. PHP's server is this program itself
// (simmarketplace-test --serve PORT), so the test depends on no other
// program: a python3 run from the stand-in PATH did not answer on macOS
// (CI), where the system's python3 is a launcher that finds the real one by
// its own location and the PATH. It serves as PHP's does, worker processes
// and all (PHP_CLI_SERVER_WORKERS, which serve.sh sets), and its workers
// never get a parent-death signal: they outlive a server stopped alone, as
// PHP's do on a Mac (PHP gives them one only on Linux and FreeBSD), on
// every computer the test runs on.
//
// Then the one catalog every simulator shares (docs/APP-STORE.md 3.16),
// with the checkout's real bin/serve.sh and the stand-in php: simulators
// are this program too (--simulator: a SimInstances entry and a
// SimMarketplace, its states on stdout, "stop" on stdin), so the catalog's
// lifetime is tried across processes: the first one starts it (importing a
// checkout's old catalog into the shared folder), a second uses it, the
// first quitting leaves it to the second, the second crashing stops it
// within the watch's grace, one killed under a simulator is started again,
// one stopped from the menu stays stopped, one killed while serve.sh sets
// the catalog up leaves nothing running (with no parent-death signal: as on
// a Mac, on Linux too), two simulators starting it at once set it up one
// after the other and serve one, one answering from another program while
// this simulator's serve.sh starts (its first look missed an older
// simulator's) is not taken for this folder's, one an older simulator runs
// (no server.json) is used as it is, and in the end nothing it started is
// left running.
//
//   build/simmarketplace-test
//
// Any check that fails prints what it looks like then: what each simulator
// said (its states and its log), server.json, the stop marker, the
// simulators' folder, the catalog's log and the processes the test
// started, with the time. SIMMARKETPLACE_TEST_KEEP=1 also keeps its folders
// and times every check; SIMMARKETPLACE_TEST_TRACE=1 runs the shared
// catalog's serve.sh with set -x.

#include "siminstances.h"
#include "simmarketplace.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QProcess>
#include <QSet>
#include <QStandardPaths>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QTimer>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

static int failures = 0;
static std::atomic<int> checks{ 0 };
static QElapsedTimer since;
static void lookAround();
static void check(bool ok, const char *what)
{
    ++checks;
    if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP"))
        std::printf("[%6lld] ", since.elapsed());
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    std::fflush(stdout);
    if (!ok) {
        ++failures;
        lookAround();
    }
}

// PHP's built-in server as the catalog runs it (php -S 127.0.0.1:PORT):
// listens on the port, SO_REUSEADDR as PHP does (a port another program
// listens on: it says so and ends, as PHP does), and with
// PHP_CLI_SERVER_WORKERS=N forks N worker processes that serve the port
// beside it (php-src sapi/cli/php_cli_server.c,
// php_cli_server_startup_workers). PHP gives its workers a parent-death
// signal where there is one (php_cli_server_worker_install_pdeathsig: Linux
// and FreeBSD); these never get one, as on a Mac: whoever stops the server
// stops them too, or they serve on. Each connection is closed at once. No
// Qt (it forks); every process ends after a minute whatever happens, so a
// failing test leaves nothing behind for long.
static int fakePhpServer(int port)
{
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    const int one = 1;
    sockaddr_in a {};
    a.sin_family = AF_INET;
    a.sin_port = htons(quint16(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (fd < 0 || ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one) != 0
        || ::bind(fd, reinterpret_cast<sockaddr *>(&a), sizeof a) != 0 || ::listen(fd, 50) != 0) {
        std::fprintf(stderr, "Failed to listen on 127.0.0.1:%d (reason: %s)\n", port, std::strerror(errno));
        return 1;
    }
    const pid_t master = ::getpid();
    const char *w = std::getenv("PHP_CLI_SERVER_WORKERS");
    const int workers = w ? std::atoi(w) : 0;
    for (int i = 0; workers > 1 && i < workers; ++i) {
        const pid_t pid = ::fork();
        if (pid == 0) {
            // PHP's worker checks that its server is still there.
            if (::getppid() != master)
                ::_exit(1);
            break;
        }
    }
    std::printf("listening on %d (process %d%s)\n", port, int(::getpid()), ::getpid() == master ? "" : ", a worker");
    std::fflush(stdout);
    ::alarm(60);
    for (;;) {
        const int c = ::accept(fd, nullptr, nullptr);
        if (c >= 0)
            ::close(c);
        else if (errno != EINTR)
            ::usleep(10000);
    }
}

// Whether anything answers on the port within a second (for the stand-in
// php's `php -r '... fsockopen ...' PORT`, serve.sh's look at the port).
static int fakeAnswers(int port)
{
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0)
        return 2;
    ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) | O_NONBLOCK);
    sockaddr_in a {};
    a.sin_family = AF_INET;
    a.sin_port = htons(quint16(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::connect(fd, reinterpret_cast<sockaddr *>(&a), sizeof a) == 0)
        return 0;
    if (errno != EINPROGRESS)
        return 1;
    pollfd p { fd, POLLOUT, 0 };
    if (::poll(&p, 1, 1000) != 1)
        return 1;
    int err = 0;
    socklen_t len = sizeof err;
    ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len);
    return err == 0 ? 0 : 1;
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
// A try that times out is tried again: on Linux a connection whose ports
// are those of one the server closed a moment ago (its side in TIME_WAIT)
// gets no answer for a second, server or none (seen here under load, the
// server gone and only those TIME_WAITs left on the port).
static bool refused(quint16 port)
{
    for (int i = 0; i < 3; ++i) {
        QTcpSocket socket;
        socket.connectToHost(QHostAddress(QHostAddress::LocalHost), port);
        if (socket.waitForConnected(1000))
            return false;
        if (socket.error() != QAbstractSocket::SocketTimeoutError)
            return socket.error() == QAbstractSocket::ConnectionRefusedError;
    }
    return false;
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
// destructors run), SIGKILL is a crash. Its catalog's log (the
// phoenix.sim.catalog lines) goes to stderr.
static int simulator(QCoreApplication &app, const QString &repo, quint16 port, const QString &instancesDir, const QString &name)
{
    std::signal(SIGTERM, [](int) { terminated = true; });
    // "-": a simulator that does not list itself (a screenshot's run).
    SimInstances instances(instancesDir, name);
    if (name != QLatin1String("-"))
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

struct Sim;
static QList<Sim *> g_sims;

// One of those simulators, run from the test: its states as they come.
struct Sim {
    QByteArray name;
    QProcess p;
    QByteArray out;
    QByteArray err;
    explicit Sim(const char *n) : name(n) { g_sims << this; }
    // listedAs: its --instance ("-": not listed).
    void start(const QString &repo, quint16 port, const QString &instancesDir, const QString &listedAs,
               const QProcessEnvironment &env = QProcessEnvironment::systemEnvironment())
    {
        p.setProcessEnvironment(env);
        QObject::connect(&p, &QProcess::readyReadStandardOutput, [this]() { out += p.readAllStandardOutput(); });
        QObject::connect(&p, &QProcess::readyReadStandardError, [this]() { err += p.readAllStandardError(); });
        p.start(QCoreApplication::applicationFilePath(),
                { QStringLiteral("--simulator"), repo, QString::number(port), instancesDir, listedAs });
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
    // Its state now: the last it said ("state running shared").
    QByteArray state() const
    {
        const int at = out.lastIndexOf("state ");
        return at < 0 ? QByteArray() : out.mid(at, out.indexOf('\n', at) - at);
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
        g_sims.removeOne(this);
    }
};

// What the catalog looks like, printed after a failed check (lookAround).
static struct {
    QString root;       // the test's folders
    QString folder;     // the catalog's folder now
    QString instances;  // the simulators' folder (the shared half)
    QString ps;         // ps, found before the PATH is the stand-in's
    quint16 port = 0;   // the catalog's port now
    int shown = 0;
} look;
// The catalog's log lines of this test's own SimMarketplace objects.
static QByteArray ownLog;

static QByteArray indented(const QByteArray &text)
{
    QByteArray out;
    for (const QByteArray &line : text.trimmed().split('\n'))
        out += "  | " + line + '\n';
    return text.trimmed().isEmpty() ? QByteArrayLiteral("  | (nothing)\n") : out;
}

// The processes of the test: this one's descendants, and any whose command
// names its folders or its program (a watch, a serve.sh or PHP's stand-in
// left on their own), with theirs. Portable: ps's pid, ppid, pgid, stat and
// command columns, on macOS and Linux alike.
static QByteArray processes()
{
    if (look.ps.isEmpty())
        return "  | (no ps)\n";
    QProcess ps;
    ps.start(look.ps, { QStringLiteral("-A"), QStringLiteral("-o"), QStringLiteral("pid="), QStringLiteral("-o"), QStringLiteral("ppid="),
                        QStringLiteral("-o"), QStringLiteral("pgid="), QStringLiteral("-o"), QStringLiteral("stat="),
                        QStringLiteral("-o"), QStringLiteral("command=") });
    const qint64 psPid = ps.processId();
    if (!ps.waitForFinished(10000))
        return "  | (ps did not answer)\n";
    struct Proc {
        qint64 ppid;
        QByteArray line;
        QByteArray command;
    };
    QHash<qint64, Proc> all;
    for (const QByteArray &line : ps.readAllStandardOutput().split('\n')) {
        const QList<QByteArray> f = line.simplified().split(' ');
        if (f.size() < 5 || f[0].toLongLong() == psPid)
            continue;
        all.insert(f[0].toLongLong(), { f[1].toLongLong(), line.simplified(), f.mid(4).join(' ') });
    }
    const QByteArray root = QFile::encodeName(look.root);
    const QByteArray real = QFile::encodeName(QFileInfo(look.root).canonicalFilePath());
    const QByteArray program = QFile::encodeName(QCoreApplication::applicationFilePath());
    // Not what started the test (a shell, timeout), whose command names it too.
    QSet<qint64> above;
    for (qint64 pid = all.value(QCoreApplication::applicationPid()).ppid; pid > 1 && !above.contains(pid); pid = all.value(pid).ppid)
        above.insert(pid);
    QSet<qint64> shown { QCoreApplication::applicationPid() };
    for (auto it = all.cbegin(); it != all.cend(); ++it) {
        if (!above.contains(it.key())
            && (it->command.contains(root) || (!real.isEmpty() && it->command.contains(real)) || it->command.contains(program)))
            shown.insert(it.key());
    }
    for (bool more = true; more;) {
        more = false;
        for (auto it = all.cbegin(); it != all.cend(); ++it) {
            if (!shown.contains(it.key()) && shown.contains(it->ppid)) {
                shown.insert(it.key());
                more = true;
            }
        }
    }
    QList<qint64> pids(shown.cbegin(), shown.cend());
    std::sort(pids.begin(), pids.end());
    QByteArray out = "  | pid ppid pgid stat command\n";
    for (const qint64 pid : pids) {
        if (all.contains(pid))
            out += "  | " + all.value(pid).line + '\n';
    }
    return out;
}

// The test's processes other than itself (a catalog or a serve.sh left
// running), as processes() lists them.
static int leftOver()
{
    int n = 0;
    const QList<QByteArray> lines = processes().split('\n');
    for (const QByteArray &line : lines) {
        const QList<QByteArray> f = line.mid(4).simplified().split(' ');
        if (f.size() >= 5 && f[0].toLongLong() > 0 && f[0].toLongLong() != QCoreApplication::applicationPid())
            ++n;
    }
    return n;
}

static void lookAround()
{
    if (++look.shown > 10) {
        if (look.shown == 11)
            std::printf("  (what it looks like is not shown again: 10 shown)\n");
        return;
    }
    QByteArray o = "  === what it looks like after that failure, at " + QByteArray::number(since.elapsed()) + " ms\n";
    for (const Sim *s : std::as_const(g_sims)) {
        o += "  --- simulator " + s->name + " (process " + QByteArray::number(s->p.processId()) + ", "
            + (s->p.state() == QProcess::NotRunning ? "ended" : "running") + "): what it said\n" + indented(s->out);
        o += "  --- its catalog's log\n" + indented(s->err);
    }
    if (!ownLog.isEmpty())
        o += "  --- the catalog's log of this test's own SimMarketplace\n" + indented(ownLog);
    if (!look.folder.isEmpty()) {
        o += "  --- " + QFile::encodeName(look.folder) + "/server.json\n" + indented(readAll(look.folder + QStringLiteral("/server.json")));
        o += QByteArray("  --- server.stopped (the stop from the menu): ")
            + (QFileInfo::exists(look.folder + QStringLiteral("/server.stopped")) ? "there\n" : "not there\n");
        o += "  --- simulator.log (its last 4000 bytes)\n" + indented(readAll(look.folder + QStringLiteral("/simulator.log")).right(4000));
    }
    if (!look.instances.isEmpty()) {
        QByteArray listed;
        for (const QFileInfo &f : QDir(look.instances).entryInfoList({ QStringLiteral("*.json") }, QDir::Files))
            listed += QFile::encodeName(f.fileName()) + ": " + readAll(f.filePath()).trimmed() + '\n';
        o += "  --- the simulators' folder\n" + indented(listed);
    }
    if (look.port) {
        QTcpSocket s;
        s.connectToHost(QHostAddress(QHostAddress::LocalHost), look.port);
        o += "  --- port " + QByteArray::number(look.port) + ": "
            + (s.waitForConnected(1000) ? QByteArray("answers") : s.errorString().toUtf8()) + '\n';
    }
    o += "  --- processes\n" + processes();
    o += "  ===\n";
    std::fwrite(o.constData(), 1, size_t(o.size()), stdout);
    std::fflush(stdout);
}

int main(int argc, char **argv)
{
    // The stand-ins for PHP's server and for serve.sh's look at the port:
    // before anything of Qt (the server forks).
    if (argc == 3 && std::strcmp(argv[1], "--serve") == 0)
        return fakePhpServer(std::atoi(argv[2]));
    if (argc == 3 && std::strcmp(argv[1], "--answers") == 0)
        return fakeAnswers(std::atoi(argv[2]));
    QCoreApplication app(argc, argv);
    if (argc == 6 && qstrcmp(argv[1], "--simulator") == 0)
        return simulator(app, QString::fromLocal8Bit(argv[2]), quint16(QByteArray(argv[3]).toUInt()),
                         QString::fromLocal8Bit(argv[4]), QString::fromLocal8Bit(argv[5]));
    // Whatever happens, the test ends: a stuck wait fails it after four
    // minutes (it takes about a minute and a half), saying where.
    std::thread([] {
        std::this_thread::sleep_for(std::chrono::seconds(240));
        std::fprintf(stderr, "FAIL simmarketplace-test is stuck (after %d checks); stopped by its watchdog\n", checks.load());
        ::_exit(3);
    }).detach();
    qputenv("FAKE_CATALOG_SERVER", QFile::encodeName(QCoreApplication::applicationFilePath()));
    // PHP's server with workers, as serve.sh starts it (the first half's
    // stand-in serve.sh runs it as the simulator's child), unless told
    // otherwise as serve.sh is.
    if (!qEnvironmentVariableIsSet("PHP_CLI_SERVER_WORKERS"))
        qputenv("PHP_CLI_SERVER_WORKERS", "4");
    // What the catalog's code decides, and why: the simulators' on their
    // stderr (shown when a check fails), with the time; this test's own
    // SimMarketplace's kept for the same.
    qputenv("QT_LOGGING_RULES", "phoenix.sim.catalog.info=true");
    qputenv("QT_MESSAGE_PATTERN", "%{time process} %{message}");
    QLoggingCategory::setFilterRules(QStringLiteral("phoenix.sim.catalog.info=true"));
    qInstallMessageHandler([](QtMsgType type, const QMessageLogContext &context, const QString &message) {
        const QByteArray line = QByteArray::number(since.elapsed()) + " ms " + message.toUtf8() + '\n';
        if (context.category && qstrcmp(context.category, "phoenix.sim.catalog") == 0 && type == QtInfoMsg)
            ownLog += line;
        else
            std::fputs(line.constData(), stderr);
    });
    since.start();
    look.ps = QStandardPaths::findExecutable(QStringLiteral("ps"));
    QTemporaryDir root;
    look.root = root.path();
    // SIMMARKETPLACE_TEST_KEEP=1: its folders are kept, to look at the logs.
    if (qEnvironmentVariableIsSet("SIMMARKETPLACE_TEST_KEEP")) {
        root.setAutoRemove(false);
        std::printf("kept: %s\n", qPrintable(root.path()));
    }
    // The catalog's folder: the shared one, here the test's own.
    const QString folder = root.filePath(QStringLiteral("catalog"));
    look.folder = folder;
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
        look.port = port;
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
        check(waitFor([&] { return refused(port); }, 5000), "and the server is gone, its worker processes too");
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
        look.port = port;
        {
            SimMarketplace m(repo, port);
            check(m.start(20000) && m.ownsServer(), "start() waits until it runs");
        }
        check(waitFor([&] { return refused(port); }, 5000), "gone with the simulator, its worker processes too");
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
    look.folder = sharedFolder;
    look.instances = instancesDir;
    ownLog.clear();
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
    // PHP: its server is this program (--serve); serve.sh's look at the
    // port (php -r '... fsockopen ...' PORT) is too (--answers); the
    // catalog's commands do nothing but the setup's seed, which puts the
    // curated apps in once, as Catalog::seedCurated does: those the
    // database lacks are looked for, then inserted (two seeds at once: the
    // second fails as PHP does, "UNIQUE constraint failed"), and takes two
    // seconds more while the catalog's folder has a "slow" file (python3
    // and node are not on this PATH: the fill and the connectors say so in
    // the log).
    write(bin + QStringLiteral("/php"),
          "#!/bin/sh\n"
          "case \"$1\" in\n"
          "  -S) exec \"$FAKE_CATALOG_SERVER\" --serve \"${2##*:}\" ;;\n"
          "  -r) case \"$2\" in *fsockopen*) exec \"$FAKE_CATALOG_SERVER\" --answers \"$3\" ;; esac ;;\n"
          "esac\n"
          "[ \"$2\" = seed ] || exit 0\n"
          "[ ! -f \"$MARKETPLACE_DATA/slow\" ] || sleep 2\n"
          "[ ! -f \"$MARKETPLACE_DATA/curated\" ] || exit 0\n"
          "sleep 0.3\n"
          "if [ -f \"$MARKETPLACE_DATA/curated\" ]; then\n"
          "  echo 'PHP Fatal error:  Uncaught PDOException: SQLSTATE[23000]: Integrity constraint violation: 19 UNIQUE constraint failed: apps.id' >&2\n"
          "  exit 255\n"
          "fi\n"
          ": > \"$MARKETPLACE_DATA/curated\"\n",
          true);
    const quint16 port = freePort();
    look.port = port;
    const auto serverJson = [&] { return QJsonDocument::fromJson(readAll(sharedFolder + QStringLiteral("/server.json"))).object(); };
    {
        Sim a("a"), b("b");
        a.start(repo2, port, instancesDir, QStringLiteral("a"));
        check(a.said("state running here", 20000), "the first simulator starts the shared catalog");
        check(readAll(sharedFolder + QStringLiteral("/signing.key")) == "old key\n"
                  && readAll(sharedFolder + QStringLiteral("/marketplace.sqlite")) == "old apps",
              "the first start imports the checkout's old catalog, its key and its apps, into the shared folder");
        check(QFile::exists(repo2 + QStringLiteral("/server/marketplace/data/signing.key")), "... and leaves the old folder as it was");
        check(readAll(sharedFolder + QStringLiteral("/simulator.log")).contains("Imported the catalog of "), "... saying so in the log");
        check(serverJson().value(QStringLiteral("port")).toInt() == port && serverJson().value(QStringLiteral("pid")).toInteger() > 0
                  && serverJson().value(QStringLiteral("by")).toInteger() == a.p.processId(),
              "server.json says it runs: its watch's process, its port, and the simulator that started it");

        b.start(repo2, port, instancesDir, QStringLiteral("b"));
        check(b.said("state running shared", 10000), "a second simulator uses it: this folder's, started by another");
        // A crashed simulator's entry whose process id is now another program's (this test's): not counted.
        write(instancesDir + QStringLiteral("/phoenix-sim-ghost.json"),
              QStringLiteral("{\"exe\":\"phoenix-sim\",\"info\":{},\"name\":\"ghost\",\"pid\":%1,\"socket\":\"/nowhere\"}")
                  .arg(QCoreApplication::applicationPid()).toUtf8());

        check(a.quit() && a.p.exitStatus() == QProcess::NormalExit && a.p.exitCode() == 0, "the first simulator quits");
        waitFor([] { return false; }, 4000);
        check(answers(port) && b.p.state() == QProcess::Running, "the catalog goes on for the second one, past the watch's grace");
        check(!QFile::exists(instancesDir + QStringLiteral("/phoenix-sim-a.json")), "... the first one's entry gone");

        b.crash();
        QElapsedTimer t;
        t.start();
        const bool stopped = waitFor([&] { return refused(port); }, 10000);
        check(stopped, qPrintable(QStringLiteral("the last one crashing: the catalog stops within the grace (%1 ms)").arg(t.elapsed())));
        check(waitFor([&] { return !QFile::exists(sharedFolder + QStringLiteral("/server.json")); }, 3000), "... and server.json goes");
        QFile::remove(instancesDir + QStringLiteral("/phoenix-sim-ghost.json"));
    }
    {
        // Killed under a simulator (not from the menu): started again.
        Sim c("c");
        c.start(repo2, port, instancesDir, QStringLiteral("c"));
        int at = 0;
        check(c.said("state running here", 20000, &at), "a simulator starts it again (set up already: no import)");
        const qint64 watch = serverJson().value(QStringLiteral("pid")).toInteger();
        check(watch > 0 && ::kill(static_cast<pid_t>(watch), SIGTERM) == 0, "its watch is stopped (someone kills it)");
        check(c.said("state running here", 20000, &at) && answers(port), "the simulator finds it gone and starts it again");

        // Stopped from the menu: for every simulator, and not started again.
        c.p.write("stop\n");
        check(c.said("state stopped ", 5000, &at), "stopped from the menu");
        check(waitFor([&] { return refused(port); }, 5000), "... the server is gone");
        waitFor([] { return false; }, 4000);
        check(refused(port) && c.out.indexOf("state starting", at) < 0, "... and stays gone (the simulator does not start it again)");
        check(c.quit(), "the simulator quits");
    }
    {
        // A simulator that does not list itself (a screenshot's run) started it: it counts while it runs.
        Sim d("d");
        d.start(repo2, port, instancesDir, QStringLiteral("-"));
        check(d.said("state running here", 20000), "a simulator that does not list itself starts it");
        waitFor([] { return false; }, 4000);
        check(answers(port) && !QFile::exists(instancesDir + QStringLiteral("/phoenix-sim--.json")),
              "... and it goes on past the grace while that simulator runs, unlisted");
        d.crash();
        check(waitFor([&] { return refused(port); }, 10000), "... and stops when it is gone");
    }
    {
        // A simulator killed while serve.sh sets the catalog up, where
        // nothing stops serve.sh with it (a Mac; on Linux too here: no
        // parent-death signal for this one): serve.sh does not start the
        // catalog for a simulator that is gone.
        write(sharedFolder + QStringLiteral("/slow"), "");
        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        env.insert(QStringLiteral("SIMMARKETPLACE_TEST_NO_PDEATHSIG"), QStringLiteral("1"));
        Sim e("e");
        e.start(repo2, port, instancesDir, QStringLiteral("e"), env);
        int at = 0;
        // Its second "starting": serve.sh started (settingUp changed).
        check(e.said("state starting ", 5000, &at) && e.said("state starting ", 5000, &at), "a simulator starts serve.sh (slowly setting up)");
        waitFor([] { return false; }, 300);
        e.crash();
        bool answered = false;
        waitFor([&] { answered = answered || answers(port); return answered; }, 5000);
        check(!answered && !QFile::exists(sharedFolder + QStringLiteral("/server.json")),
              "killed while serve.sh sets the catalog up: serve.sh does not start it after");
        check(readAll(sharedFolder + QStringLiteral("/simulator.log")).contains("is gone: the catalog is not started"), "... saying so in the log");
        QFile::remove(sharedFolder + QStringLiteral("/slow"));
        // (Should it have started, it is gone before the next case.)
        waitFor([&] { return refused(port); }, 10000);
    }
    {
        // Two simulators starting it at once, the first time (a catalog
        // folder not set up yet): both find nothing answering and both
        // start serve.sh. One sets the catalog up, then the other (not
        // both at once: neither fails); one catalog serves, the one PHP that
        // could listen. server.json names its watch, both simulators know
        // it as this folder's (the one whose serve.sh serves it "here",
        // the other "shared"), and a stop from either's menu holds for both.
        const QString folder2 = shared + QStringLiteral("/catalog-2");
        look.folder = folder2;
        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        env.insert(QStringLiteral("MARKETPLACE_DATA"), folder2);
        const auto serverJson = [&] { return QJsonDocument::fromJson(readAll(folder2 + QStringLiteral("/server.json"))).object(); };
        Sim f("f"), g("g");
        f.start(repo2, port, instancesDir, QStringLiteral("f"), env);
        g.start(repo2, port, instancesDir, QStringLiteral("g"), env);
        check(waitFor([&] { return f.state().startsWith("state running") && g.state().startsWith("state running"); }, 20000),
              "two simulators starting it at once: both find it running");
        const QList<QByteArray> both { f.state(), g.state() };
        check(both.contains("state running here") && both.contains("state running shared"),
              qPrintable(QStringLiteral("... one serves it, the other uses it (%1, %2)")
                             .arg(QString::fromUtf8(both[0]), QString::fromUtf8(both[1]))));
        const qint64 by = serverJson().value(QStringLiteral("by")).toInteger();
        Sim &here = f.state() == "state running here" ? f : g;
        Sim &other = &here == &f ? g : f;
        check(by == here.p.processId() && ::kill(static_cast<pid_t>(serverJson().value(QStringLiteral("pid")).toInteger()), 0) == 0,
              "... server.json names its watch, started by the one that says here");
        const int atHere = here.out.size(), atOther = other.out.size();
        other.p.write("stop\n");
        check(other.said("state stopped ", 5000) && waitFor([&] { return refused(port); }, 5000),
              "a stop from the other's menu stops it");
        check(here.said("state stopped ", 5000), "... for both: the one that started it says stopped");
        waitFor([] { return false; }, 3000);
        check(refused(port) && other.out.indexOf("state starting", atOther) < 0 && here.out.indexOf("state starting", atHere) < 0,
              "... and it stays gone");
        check(f.quit() && g.quit(), "both quit");
        look.folder = sharedFolder;
    }
    {
        // One this simulator started serve.sh for, but which answers from
        // another program (an older simulator's catalog that its first look
        // missed, or that came up meanwhile): its watch's PHP cannot listen
        // there and claims nothing, and what answers is not taken for this
        // folder's catalog (its key would not be the folder's).
        write(sharedFolder + QStringLiteral("/slow"), "");
        const quint16 olderPort = freePort();
        look.port = olderPort;
        SimMarketplace m(repo2, olderPort);
        m.setInstancesDir(instancesDir);
        const int from = ownLog.size();
        m.startAsync(15000);
        check(waitFor([&] { return ownLog.indexOf("starting serve.sh", from) >= 0; }, 3000), "nothing answers yet: serve.sh is started");
        QTcpServer older;
        older.listen(QHostAddress::LocalHost, olderPort);
        const bool used = waitFor([&] { return m.state() == SimMarketplace::Running; }, 15000);
        check(used && m.origin() == QLatin1String("older") && m.key().isEmpty() && !m.ownsServer(),
              qPrintable(QStringLiteral("... another program answers meanwhile: used as an older simulator's, not this folder's (%1, %2)")
                             .arg(m.stateName(), m.origin())));
        m.stop();
        check(m.state() == SimMarketplace::Running && !QFile::exists(sharedFolder + QStringLiteral("/server.json")),
              "... not stopped from here, and nothing claims it");
        QFile::remove(sharedFolder + QStringLiteral("/slow"));
    }
    {
        // One an older simulator runs (no server.json of this folder): used as it is, its key unknown.
        QTcpServer older;
        older.listen(QHostAddress::LocalHost, 0);
        look.port = older.serverPort();
        SimMarketplace m(repo2, older.serverPort());
        m.setInstancesDir(instancesDir);
        check(m.start(10000) && m.origin() == QLatin1String("older") && !m.ownsServer(), "an older simulator's catalog: used as it is");
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
    look.port = port;
    // Every simulator gone, every catalog stopped: nothing the test started
    // goes on (no watch, no PHP, no worker of PHP's).
    check(waitFor([] { return leftOver() == 0; }, 6000), "in the end nothing it started is left running");

    std::printf(failures ? "\n%d check(s) failed\n" : "\nAll checks passed.\n", failures);
    return failures ? 1 : 0;
}
