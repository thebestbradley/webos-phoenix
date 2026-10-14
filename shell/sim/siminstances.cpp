// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "siminstances.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QFileSystemWatcher>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLocalServer>
#include <QLocalSocket>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTimer>

#include <algorithm>
#include <cerrno>
#include <csignal>
#include <unistd.h>

namespace {

const char kRaise[] = "raise\n";

// A process by its id: there (kill with no signal; EPERM: someone else's).
bool processAlive(qint64 pid)
{
    if (pid <= 0)
        return false;
    return ::kill(static_cast<pid_t>(pid), 0) == 0 || errno == EPERM;
}

} // namespace

SimInstances::SimInstances(const QString &dir, const QString &name, QObject *parent)
    : QObject(parent)
    , m_dir(dir)
    , m_name(name)
    , m_key(keyFor(name))
{
}

SimInstances::~SimInstances()
{
    removeEntry();
}

QString SimInstances::defaultDir()
{
    QString runtime = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
    if (runtime.isEmpty())
        runtime = QDir::tempPath();
    return QDir(runtime).filePath(QStringLiteral("phoenix-sim-instances"));
}

QString SimInstances::keyFor(const QString &name)
{
    return name.isEmpty() ? QStringLiteral("phoenix-sim") : QStringLiteral("phoenix-sim-") + name;
}

// KEY.sock beside the entry. A socket's path has room for about 100
// bytes (sockaddr_un: 104 on a Mac, 108 on Linux): in a folder deeper
// than that it goes in the temporary folder (a Mac's is the user's own),
// under a name made from the folder and the key. The entry says where.
QString SimInstances::socketPath() const
{
    const QString path = QDir(m_dir).filePath(m_key + QStringLiteral(".sock"));
    if (QFile::encodeName(path).size() < 100)
        return path;
    const QByteArray hash = QCryptographicHash::hash((m_dir + QLatin1Char('/') + m_key).toUtf8(), QCryptographicHash::Sha1).toHex().left(16);
    return QDir(QDir::tempPath()).filePath(QStringLiteral("phoenix-sim-%1-%2.sock").arg(::getuid()).arg(QString::fromLatin1(hash)));
}

// A socket a live simulator listens on takes a connection at once (the
// kernel's backlog, even while that simulator is busy); a dead one's
// refuses it.
bool SimInstances::answers(const QString &socket)
{
    QLocalSocket s;
    s.connectToServer(socket);
    const bool ok = s.waitForConnected(200);
    s.abort();
    return ok;
}

bool SimInstances::start(const QVariantMap &info)
{
    m_info = info;
    return tryRegister();
}

bool SimInstances::tryRegister()
{
    if (m_registered)
        return true;
    QDir dir(m_dir);
    if (!dir.mkpath(QStringLiteral(".")))
        return false;
    // Only this user's simulators: the folder is theirs alone.
    QFile::setPermissions(m_dir, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner);
    // The others as they come and go, listed or not.
    if (!m_watcher) {
        m_watcher = new QFileSystemWatcher(QStringList { m_dir }, this);
        connect(m_watcher, &QFileSystemWatcher::directoryChanged, this, &SimInstances::changed);
    }

    const QString socket = socketPath();
    if (QFile::exists(socket)) {
        // Another simulator running as this instance (the one this
        // restarts, quitting): this one lists itself once it is gone.
        if (answers(socket)) {
            m_waiting = true;
            if (!m_retry) {
                m_retry = new QTimer(this);
                m_retry->setInterval(1000);
                connect(m_retry, &QTimer::timeout, this, [this]() {
                    if (tryRegister())
                        emit changed();
                });
            }
            m_retry->start();
            return false;
        }
        QLocalServer::removeServer(socket);
    }
    m_waiting = false;
    if (m_retry)
        m_retry->stop();
    m_server = new QLocalServer(this);
    m_server->setSocketOptions(QLocalServer::UserAccessOption);
    if (!m_server->listen(socket)) {
        delete m_server;
        m_server = nullptr;
        return false;
    }
    connect(m_server, &QLocalServer::newConnection, this, [this]() {
        while (QLocalSocket *client = m_server->nextPendingConnection()) {
            connect(client, &QLocalSocket::disconnected, client, &QObject::deleteLater);
            connect(client, &QLocalSocket::readyRead, this, [this, client]() {
                while (client->canReadLine()) {
                    if (client->readLine() == kRaise)
                        emit raiseRequested();
                }
            });
        }
    });
    // Listening first, then listed: an entry's socket always answers.
    if (!writeEntry()) {
        m_server->close();
        delete m_server;
        m_server = nullptr;
        return false;
    }
    m_registered = true;
    return true;
}

void SimInstances::setInfo(const QVariantMap &info)
{
    if (info == m_info)
        return;
    m_info = info;
    if (m_registered)
        writeEntry();
}

bool SimInstances::writeEntry()
{
    QJsonObject entry {
        { QStringLiteral("name"), m_name },
        { QStringLiteral("pid"), QCoreApplication::applicationPid() },
        // Its program's name: the catalog's watch (server/marketplace/bin/
        // serve.sh) checks that the process of this id is still it.
        { QStringLiteral("exe"), QFileInfo(QCoreApplication::applicationFilePath()).fileName() },
        { QStringLiteral("socket"), socketPath() },
        { QStringLiteral("info"), QJsonObject::fromVariantMap(m_info) },
    };
    // Whole or not at all: another simulator may read it any moment.
    QSaveFile file(QDir(m_dir).filePath(m_key + QStringLiteral(".json")));
    if (!file.open(QIODevice::WriteOnly))
        return false;
    file.write(QJsonDocument(entry).toJson(QJsonDocument::Compact));
    return file.commit();
}

void SimInstances::removeEntry()
{
    if (!m_registered)
        return;
    m_registered = false;
    // Unlisted first, then deaf: a listed socket always answers.
    QFile::remove(QDir(m_dir).filePath(m_key + QStringLiteral(".json")));
    if (m_server) {
        m_server->close();
        QLocalServer::removeServer(socketPath());
    }
}

QList<SimInstances::Instance> SimInstances::instances()
{
    QList<Instance> out;
    bool selfListed = false;
    const QDir dir(m_dir);
    const QStringList files = dir.entryList({ QStringLiteral("phoenix-sim*.json") }, QDir::Files);
    for (const QString &fileName : files) {
        const QString key = fileName.chopped(5);
        QFile file(dir.filePath(fileName));
        if (!file.open(QIODevice::ReadOnly))
            continue;
        const QJsonObject entry = QJsonDocument::fromJson(file.readAll()).object();
        file.close();
        Instance i;
        i.key = key;
        i.name = entry.value(QStringLiteral("name")).toString();
        i.pid = entry.value(QStringLiteral("pid")).toInteger();
        i.info = entry.value(QStringLiteral("info")).toObject().toVariantMap();
        if (key == m_key && m_registered) {
            i.self = true;
            i.pid = QCoreApplication::applicationPid();
            i.info = m_info;
            selfListed = true;
            out << i;
            continue;
        }
        const QString socket = entry.value(QStringLiteral("socket")).toString();
        // Entries are written whole (QSaveFile): one that does not read is
        // broken, and goes.
        if (entry.isEmpty() || keyFor(i.name) != key || socket.isEmpty()) {
            QFile::remove(file.fileName());
            continue;
        }
        // Its simulator gone (crashed, killed): its entry and socket go too.
        if (!processAlive(i.pid)) {
            QFile::remove(file.fileName());
            const QString socketName = QFileInfo(socket).fileName();
            if (socketName.startsWith(QLatin1String("phoenix-sim")) && socketName.endsWith(QLatin1String(".sock")))
                QFile::remove(socket);
            continue;
        }
        // Its process id now another program's: not listed, and left for
        // the next simulator of that name to take over.
        if (!answers(socket))
            continue;
        out << i;
    }
    // Not listed (an unwritable folder, its name taken): still itself.
    if (!selfListed) {
        Instance i;
        i.key = m_key;
        i.name = m_name;
        i.pid = QCoreApplication::applicationPid();
        i.info = m_info;
        i.self = true;
        out << i;
    }
    // Stable: of two with one name (one waiting for the other), itself last.
    std::stable_sort(out.begin(), out.end(), [](const Instance &a, const Instance &b) {
        if (a.name.isEmpty() != b.name.isEmpty())
            return a.name.isEmpty();
        return a.name.compare(b.name, Qt::CaseInsensitive) < 0;
    });
    return out;
}

bool SimInstances::raise(const QString &key)
{
    if (key == m_key)
        return false;
    QFile file(QDir(m_dir).filePath(key + QStringLiteral(".json")));
    if (!file.open(QIODevice::ReadOnly))
        return false;
    const QString socket = QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("socket")).toString();
    if (socket.isEmpty())
        return false;
    QLocalSocket s;
    s.connectToServer(socket);
    if (!s.waitForConnected(500))
        return false;
    s.write(kRaise);
    const bool ok = s.waitForBytesWritten(500);
    s.disconnectFromServer();
    return ok;
}
