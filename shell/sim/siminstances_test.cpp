// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// siminstances-test: the simulators' registry (siminstances.h), behind
// phoenix-sim's Window > Simulators. Two simulators in one process, and in
// two (this program again, with --child): each lists itself and sees the
// other, what it is follows as it changes, one asks the other to come to
// the front, a name in use is waited for, entries of simulators that
// crashed or broke are dropped, and a folder that cannot be written leaves
// a simulator listing only itself.
//
//   build/siminstances-test

#include "siminstances.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTimer>

#include <cstdio>
#include <functional>
#include <optional>

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    std::fflush(stdout);
    if (!ok)
        ++failures;
}

static bool waitFor(const std::function<bool()> &done, int ms = 4000)
{
    QElapsedTimer clock;
    clock.start();
    while (!done() && clock.elapsed() < ms)
        QCoreApplication::processEvents(QEventLoop::AllEvents, 20);
    return done();
}

// "Default*, v2": each one's name, * on the one asking.
static QString names(const QList<SimInstances::Instance> &list)
{
    QStringList out;
    for (const SimInstances::Instance &i : list)
        out << (i.name.isEmpty() ? QStringLiteral("Default") : i.name) + (i.self ? QStringLiteral("*") : QString());
    return out.join(QStringLiteral(", "));
}

// A copy: instances() returns a new list each time, gone once the
// statement that asked for it ends.
static std::optional<SimInstances::Instance> find(const QList<SimInstances::Instance> &list, const QString &name)
{
    for (const SimInstances::Instance &i : list)
        if (i.name == name)
            return i;
    return std::nullopt;
}

static void writeEntry(const QString &dir, const QString &key, const QByteArray &json)
{
    QFile f(QDir(dir).filePath(key + QStringLiteral(".json")));
    if (f.open(QIODevice::WriteOnly))
        f.write(json);
}

static QByteArray entry(const QString &name, qint64 pid, const QString &socket)
{
    return QJsonDocument(QJsonObject { { QStringLiteral("name"), name }, { QStringLiteral("pid"), pid },
                                       { QStringLiteral("socket"), socket }, { QStringLiteral("info"), QJsonObject() } })
        .toJson(QJsonDocument::Compact);
}

// --child DIR NAME: another simulator's registry, in a process of its own:
// lists itself, says "ready", and waits to be asked to come forward.
static int child(const QString &dir, const QString &name)
{
    SimInstances me(dir, name);
    if (!me.start({ { QStringLiteral("mode"), QStringLiteral("tablet") } }))
        return 2;
    bool raised = false;
    QObject::connect(&me, &SimInstances::raiseRequested, [&raised]() {
        raised = true;
        QCoreApplication::quit();
    });
    QTimer::singleShot(20000, &QCoreApplication::quit);
    std::printf("ready\n");
    std::fflush(stdout);
    QCoreApplication::exec();
    return raised ? 0 : 3;
}

static QProcess *startChild(const QString &dir, const QString &name)
{
    auto *p = new QProcess;
    p->start(QCoreApplication::applicationFilePath(), { QStringLiteral("--child"), dir, name });
    if (!p->waitForStarted(5000) || !waitFor([p]() { return p->canReadLine() || p->bytesAvailable() > 0
                                                      || p->state() == QProcess::NotRunning; }, 10000)
        || !p->readLine().startsWith("ready")) {
        p->kill();
        p->waitForFinished();
        delete p;
        return nullptr;
    }
    return p;
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    const QStringList args = app.arguments();
    if (args.size() == 4 && args.at(1) == QLatin1String("--child"))
        return child(args.at(2), args.at(3));

    check(SimInstances::keyFor(QString()) == QLatin1String("phoenix-sim")
              && SimInstances::keyFor(QStringLiteral("v2")) == QLatin1String("phoenix-sim-v2"),
          QStringLiteral("an instance's key is its application name: phoenix-sim, phoenix-sim-NAME"));
    const QString runtime = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
    check(SimInstances::defaultDir().endsWith(QLatin1String("/phoenix-sim-instances"))
              && (runtime.isEmpty() || SimInstances::defaultDir().startsWith(runtime)),
          QStringLiteral("the folder is the user's runtime folder's, outside any checkout: ") + SimInstances::defaultDir());

    QTemporaryDir tmp;
    const QString dir = tmp.filePath(QStringLiteral("instances"));

    // Two simulators: each lists itself and sees the other.
    auto *a = new SimInstances(dir, QString());
    auto *b = new SimInstances(dir, QStringLiteral("v2"));
    check(a->start({ { QStringLiteral("mode"), QStringLiteral("phone") }, { QStringLiteral("width"), 320 } }),
          QStringLiteral("the default instance lists itself"));
    // The socket beside the entry, unless the folder's path leaves a socket
    // no room (a Mac's temporary folder is deep): then in the temporary
    // folder, as the entry says (SimInstances::socketPath).
    const QString besideIt = QDir(dir).filePath(QStringLiteral("phoenix-sim.sock"));
    QFile entryFile(QDir(dir).filePath(QStringLiteral("phoenix-sim.json")));
    const QString socket = entryFile.open(QIODevice::ReadOnly)
        ? QJsonDocument::fromJson(entryFile.readAll()).object().value(QStringLiteral("socket")).toString()
        : QString();
    check(QFile::exists(socket)
              && (QFile::encodeName(besideIt).size() < 100 ? socket == besideIt : socket.startsWith(QDir::tempPath() + QLatin1Char('/'))),
          QStringLiteral("its entry in the folder, its socket beside it (or in the temporary folder, for a deep folder): ") + socket);
    const QFile::Permissions others = QFile::ReadGroup | QFile::WriteGroup | QFile::ExeGroup
                                      | QFile::ReadOther | QFile::WriteOther | QFile::ExeOther;
    check(!(QFile(dir).permissions() & others), QStringLiteral("the folder is the user's alone"));
    check(names(a->instances()) == QLatin1String("Default*"), QStringLiteral("one simulator: itself (") + names(a->instances()) + QLatin1Char(')'));
    check(b->start({ { QStringLiteral("mode"), QStringLiteral("tablet") }, { QStringLiteral("look"), QStringLiteral("ember-glass") } }),
          QStringLiteral("a second, v2, lists itself"));
    check(names(a->instances()) == QLatin1String("Default*, v2") && names(b->instances()) == QLatin1String("Default, v2*"),
          QStringLiteral("each sees both, the default first, itself marked (") + names(a->instances()) + QStringLiteral(" / ") + names(b->instances()) + QLatin1Char(')'));
    std::optional<SimInstances::Instance> v2 = find(a->instances(), QStringLiteral("v2"));
    check(v2 && v2->info.value(QStringLiteral("look")).toString() == QLatin1String("ember-glass") && v2->pid == QCoreApplication::applicationPid(),
          QStringLiteral("what the other is (its look, its process)"));

    // What it is follows; the other hears that its folder changed.
    int aChanged = 0;
    QObject::connect(a, &SimInstances::changed, [&aChanged]() { ++aChanged; });
    b->setInfo({ { QStringLiteral("mode"), QStringLiteral("phone") }, { QStringLiteral("width"), 320 }, { QStringLiteral("height"), 480 } });
    check(waitFor([&aChanged]() { return aChanged > 0; }), QStringLiteral("a change to another's entry is heard"));
    v2 = find(a->instances(), QStringLiteral("v2"));
    check(v2 && v2->info.value(QStringLiteral("width")).toInt() == 320 && v2->info.value(QStringLiteral("mode")).toString() == QLatin1String("phone"),
          QStringLiteral("and read: v2 is now a phone, 320 wide"));

    // Asked to come forward.
    bool bRaised = false;
    QObject::connect(b, &SimInstances::raiseRequested, [&bRaised]() { bRaised = true; });
    check(a->raise(b->key()), QStringLiteral("the default asks v2 to come forward"));
    check(waitFor([&bRaised]() { return bRaised; }), QStringLiteral("v2 hears it (raiseRequested)"));
    check(!a->raise(a->key()) && !a->raise(QStringLiteral("phoenix-sim-nonesuch")), QStringLiteral("not itself, nor one not there"));

    // A name in use (the simulator this restarts, still quitting): waited for.
    auto *c = new SimInstances(dir, QStringLiteral("v2"));
    check(!c->start({}) && c->waiting(), QStringLiteral("a second v2 waits while the first runs"));
    check(names(c->instances()) == QLatin1String("Default, v2, v2*"), QStringLiteral("and lists the others and itself (") + names(c->instances()) + QLatin1Char(')'));
    delete b;
    check(!QFile::exists(QDir(dir).filePath(QStringLiteral("phoenix-sim-v2.json"))), QStringLiteral("a simulator quitting takes its entry away"));
    check(waitFor([c]() { return c->registered(); }), QStringLiteral("then the waiting v2 lists itself"));
    check(names(a->instances()) == QLatin1String("Default*, v2"), QStringLiteral("seen by the default (") + names(a->instances()) + QLatin1Char(')'));

    // Entries left behind.
    QProcess gone;
    gone.start(QStringLiteral("/bin/sh"), { QStringLiteral("-c"), QStringLiteral("exit 0") });
    gone.waitForStarted();
    const qint64 deadPid = gone.processId();
    gone.waitForFinished();
    const QString ghostSocket = QDir(dir).filePath(QStringLiteral("phoenix-sim-ghost.sock"));
    QFile(ghostSocket).open(QIODevice::WriteOnly);
    writeEntry(dir, QStringLiteral("phoenix-sim-ghost"), entry(QStringLiteral("ghost"), deadPid, ghostSocket));
    writeEntry(dir, QStringLiteral("phoenix-sim-reused"),
               entry(QStringLiteral("reused"), QCoreApplication::applicationPid(), QDir(dir).filePath(QStringLiteral("phoenix-sim-reused.sock"))));
    writeEntry(dir, QStringLiteral("phoenix-sim-broken"), "{ not json");
    check(names(a->instances()) == QLatin1String("Default*, v2"),
          QStringLiteral("a crashed simulator's entry, one whose process id another program has, and a broken one are not listed"));
    check(!QFile::exists(QDir(dir).filePath(QStringLiteral("phoenix-sim-ghost.json"))) && !QFile::exists(ghostSocket),
          QStringLiteral("the crashed one's entry and socket are removed"));
    check(!QFile::exists(QDir(dir).filePath(QStringLiteral("phoenix-sim-broken.json"))), QStringLiteral("the broken one is removed"));

    // A folder too deep for a socket's path (about 100 bytes): the socket
    // goes in the temporary folder, and the two still find each other.
    const QString deep = tmp.filePath(QStringLiteral("a-folder-deeper-than-a-unix-socket-path-has-room-for/"
                                                     "as-a-runtime-folder-under-a-long-home-can-be/instances"));
    {
        SimInstances x(deep, QStringLiteral("x")), y(deep, QStringLiteral("y"));
        bool yRaised = false;
        QObject::connect(&y, &SimInstances::raiseRequested, [&yRaised]() { yRaised = true; });
        check(QFile::encodeName(deep).size() > 100 && x.start({}) && y.start({}) && names(x.instances()) == QLatin1String("x*, y"),
              QStringLiteral("in a folder too deep for a socket: listed, and each sees the other"));
        check(x.raise(y.key()) && waitFor([&yRaised]() { return yRaised; }), QStringLiteral("and asks it to come forward"));
    }
    check(QDir(deep).entryList(QDir::Files).isEmpty(), QStringLiteral("gone, they leave nothing there"));

    // A folder that cannot be made: listed nowhere, but itself.
    QFile blocker(tmp.filePath(QStringLiteral("file")));
    blocker.open(QIODevice::WriteOnly);
    blocker.close();
    SimInstances lone(tmp.filePath(QStringLiteral("file/instances")), QStringLiteral("lone"));
    check(!lone.start({}) && !lone.waiting() && names(lone.instances()) == QLatin1String("lone*"),
          QStringLiteral("a folder it cannot make: not listed, not waiting, itself alone in its menu"));

    // Two processes.
    delete c;
    QProcess *other = startChild(dir, QStringLiteral("two"));
    check(other != nullptr, QStringLiteral("another process lists itself as two"));
    if (other) {
        check(names(a->instances()) == QLatin1String("Default*, two"), QStringLiteral("this one sees it (") + names(a->instances()) + QLatin1Char(')'));
        const std::optional<SimInstances::Instance> two = find(a->instances(), QStringLiteral("two"));
        check(two && two->pid == other->processId(), QStringLiteral("with its process id"));
        check(a->raise(QStringLiteral("phoenix-sim-two")), QStringLiteral("and asks it to come forward"));
        check(other->waitForFinished(5000) && other->exitCode() == 0, QStringLiteral("it heard (it quits when asked, exit 0)"));
        check(names(a->instances()) == QLatin1String("Default*"), QStringLiteral("gone, it leaves the list"));
        delete other;
    }
    other = startChild(dir, QStringLiteral("three"));
    check(other != nullptr && names(a->instances()) == QLatin1String("Default*, three"), QStringLiteral("a third process, listed"));
    if (other) {
        other->kill();
        other->waitForFinished();
        check(QFile::exists(QDir(dir).filePath(QStringLiteral("phoenix-sim-three.json"))), QStringLiteral("killed, it leaves its entry behind"));
        check(names(a->instances()) == QLatin1String("Default*"), QStringLiteral("which is dropped (") + names(a->instances()) + QLatin1Char(')'));
        check(!QFile::exists(QDir(dir).filePath(QStringLiteral("phoenix-sim-three.json"))), QStringLiteral("and removed"));
        delete other;
    }

    delete a;
    check(QDir(dir).entryList(QDir::Files | QDir::System).filter(QStringLiteral("phoenix-sim.")).isEmpty(),
          QStringLiteral("the last one quitting leaves nothing of itself"));

    std::printf("%s\n", failures ? "siminstances-test FAILED" : "siminstances-test passed");
    return failures ? 1 : 0;
}
