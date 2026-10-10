// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "speech.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
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

void Speech::setVoice(const QString &v)
{
    if (v == m_voice)
        return;
    m_voice = v;
    emit voiceChanged();
}

QString Speech::kittenProgram()
{
    // PHOENIX_TTS_PROGRAM (tests, another build); beside phoenix-sim in the
    // build tree; on a device phoenix-shell installs it into /usr/bin.
    const QString given = qEnvironmentVariable("PHOENIX_TTS_PROGRAM");
    if (!given.isEmpty())
        return QFileInfo(given).isExecutable() ? given : QString();
    const QString beside = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("phoenix-tts"));
    if (QFileInfo(beside).isExecutable())
        return beside;
    return QStandardPaths::findExecutable(QStringLiteral("phoenix-tts"));
}

bool Speech::kittenReady() const
{
    if (m_kitten >= 0)
        return m_kitten == 1;
    m_kitten = 0;
    const QString program = kittenProgram();
    if (program.isEmpty())
        return false;
    // Its --check finds the model, the dictionary and ONNX Runtime without
    // loading the model (a few milliseconds), once.
    QProcess p;
    p.start(program, { QStringLiteral("--check") });
    if (!p.waitForFinished(5000)) {
        p.kill();
        p.waitForFinished(1000);
        return false;
    }
    const QJsonObject r = QJsonDocument::fromJson(p.readAllStandardOutput()).object();
    if (!r.value(QStringLiteral("ok")).toBool()) {
        qInfo("Speech: Kitten TTS cannot speak here: %s", qPrintable(r.value(QStringLiteral("error")).toString()));
        return false;
    }
    m_kittenVoices.clear();
    for (const QJsonValue &v : r.value(QStringLiteral("voices")).toArray())
        m_kittenVoices << v.toString();
    m_kitten = 1;
    return true;
}

QStringList Speech::voices() const
{
    return m_command.isEmpty() && kittenReady() ? m_kittenVoices : QStringList();
}

// The speech programs before Kitten, in the order they are looked for.
QStringList Speech::fallback() const
{
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

QStringList Speech::resolved(const QString &lang) const
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
    // Kitten speaks English (its phonemes are English); other languages go
    // to the fallback (espeak-ng speaks many).
    if ((lang.isEmpty() || lang.startsWith(QLatin1String("en"))) && kittenReady())
        return { kittenProgram(), QStringLiteral("--voice"), QStringLiteral("%v") };
    return fallback();
}

QString Speech::engine() const
{
    const QStringList c = resolved();
    if (c.isEmpty())
        return QString();
    const QString name = QFileInfo(c.first()).fileName();
    return name == QLatin1String("phoenix-tts") ? QStringLiteral("Kitten TTS") : name;
}

bool Speech::speak(const QString &text, const QString &lang, const QString &voice, double rate)
{
    const QString l = lang.isEmpty() ? QStringLiteral("en") : lang.left(5);
    const QStringList c = resolved(l);
    if (c.isEmpty() || text.trimmed().isEmpty())
        return false;
    stop();
    return run(c, text, l, voice.isEmpty() ? m_voice : voice, rate);
}

// How each engine is told the speed (175 words a minute is espeak-ng's and
// say's usual rate; Flite stretches each sound by 1 / rate).
QStringList Speech::rateArguments(const QString &program, double rate) const
{
    if (qFuzzyCompare(rate, 1.0))
        return {};
    const QString name = QFileInfo(program).fileName();
    const QString wpm = QString::number(qRound(175 * rate));
    if (name == QLatin1String("phoenix-tts"))
        return { QStringLiteral("--speed"), QString::number(rate, 'g', 3) };
    if (name == QLatin1String("espeak-ng") || name == QLatin1String("espeak"))
        return { QStringLiteral("-s"), wpm };
    if (name == QLatin1String("say"))
        return { QStringLiteral("-r"), wpm };
    if (name == QLatin1String("flite"))
        return { QStringLiteral("--setf"), QStringLiteral("duration_stretch=") + QString::number(1.0 / rate, 'g', 3) };
    return {};
}

bool Speech::run(const QStringList &c, const QString &text, const QString &lang, const QString &voice, double rate)
{
    rate = qBound(0.5, rate > 0 ? rate : 1.0, 2.0);
    QStringList args = c.mid(1);
    for (QString &a : args) {
        a.replace(QStringLiteral("%l"), lang);
        a.replace(QStringLiteral("%v"), voice);
        a.replace(QStringLiteral("%r"), QString::number(rate, 'g', 3));
        a.replace(QStringLiteral("%w"), QString::number(qRound(175 * rate)));
    }
    // A command of its own takes the speed through %r / %w only.
    if (m_command.isEmpty())
        args += rateArguments(c.first(), rate);
    const bool kitten = m_command.isEmpty() && QFileInfo(c.first()).fileName() == QLatin1String("phoenix-tts");
    auto *p = new QProcess(this);
    p->setProgram(c.first());
    p->setArguments(args);
    // Its one line about what it said and how fast goes to the log.
    p->setProcessChannelMode(QProcess::ForwardedErrorChannel);
    p->setStandardOutputFile(QProcess::nullDevice());
    connect(p, &QProcess::finished, this, [this, p, kitten, text, lang, voice, rate](int code, QProcess::ExitStatus status) {
        if (m_process != p)
            return;
        m_process = nullptr;
        p->deleteLater();
        // phoenix-tts could not speak after all (3: no model or ONNX
        // Runtime; 4: no sound output): the same words with the fallback.
        const QStringList other = fallback();
        if (kitten && status == QProcess::NormalExit && (code == 3 || code == 4) && !other.isEmpty()) {
            qInfo("Speech: Kitten TTS could not speak; %s instead", qPrintable(QFileInfo(other.first()).fileName()));
            if (code == 3)
                m_kitten = -1;  // look again next time (the model may come)
            if (run(other, text, lang, voice, rate))
                return;
        }
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
    const bool wasSpeaking = m_process != nullptr;
    m_process = p;
    p->start();
    p->write(text.toUtf8());
    p->closeWriteChannel();
    if (!wasSpeaking)
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
