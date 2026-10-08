// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "speech.h"

#include <QFileInfo>
#include <QProcess>
#include <QStandardPaths>

Speech::Speech(QObject *parent)
    : QObject(parent)
{
}

Speech::~Speech()
{
    stop();
}

void Speech::setCommand(const QStringList &c)
{
    if (c == m_command)
        return;
    m_command = c;
    emit commandChanged();
}

QStringList Speech::resolved() const
{
    if (!m_command.isEmpty()) {
        const QString p = m_command.first();
        const QString found = QFileInfo(p).isAbsolute() ? (QFileInfo(p).isExecutable() ? p : QString())
                                                        : QStandardPaths::findExecutable(p);
        if (found.isEmpty())
            return {};
        QStringList c = m_command;
        c[0] = found;
        return c;
    }
    const QString espeak = QStandardPaths::findExecutable(QStringLiteral("espeak-ng"));
    if (!espeak.isEmpty())
        return { espeak, QStringLiteral("-v"), QStringLiteral("%l"), QStringLiteral("--stdin") };
    const QString say = QStandardPaths::findExecutable(QStringLiteral("say"));
    if (!say.isEmpty())
        return { say };   // reads the text from stdin
    // Flite (BSD-3-Clause, English only): what meta-phoenix's image ships
    // (packagegroup-phoenix-assistant); it too reads stdin and plays.
    const QString flite = QStandardPaths::findExecutable(QStringLiteral("flite"));
    if (!flite.isEmpty())
        return { flite };
    return {};
}

QString Speech::engine() const
{
    const QStringList c = resolved();
    return c.isEmpty() ? QString() : QFileInfo(c.first()).fileName();
}

bool Speech::speak(const QString &text, const QString &lang)
{
    const QStringList c = resolved();
    if (c.isEmpty() || text.trimmed().isEmpty())
        return false;
    stop();
    QStringList args = c.mid(1);
    const QString l = lang.isEmpty() ? QStringLiteral("en") : lang.left(5);
    for (QString &a : args)
        a.replace(QStringLiteral("%l"), l);
    auto *p = new QProcess(this);
    p->setProgram(c.first());
    p->setArguments(args);
    p->setProcessChannelMode(QProcess::ForwardedErrorChannel);
    p->setStandardOutputFile(QProcess::nullDevice());
    connect(p, &QProcess::finished, this, [this, p]() {
        if (m_process != p)
            return;
        m_process = nullptr;
        p->deleteLater();
        emit speakingChanged();
        emit finished();
    });
    connect(p, &QProcess::errorOccurred, this, [this, p](QProcess::ProcessError e) {
        if (e != QProcess::FailedToStart || m_process != p)
            return;
        m_process = nullptr;
        p->deleteLater();
        emit speakingChanged();
        emit finished();
    });
    m_process = p;
    p->start();
    p->write(text.toUtf8());
    p->closeWriteChannel();
    emit speakingChanged();
    return true;
}

void Speech::stop()
{
    if (!m_process)
        return;
    QProcess *p = m_process;
    m_process = nullptr;
    p->disconnect(this);
    p->kill();
    p->waitForFinished(1000);
    p->deleteLater();
    emit speakingChanged();
}
