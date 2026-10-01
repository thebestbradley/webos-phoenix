// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "dictation.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QTemporaryFile>
#include <QTimer>
#include <QtEndian>
#include <cstring>

#ifdef PHOENIX_HAVE_MULTIMEDIA
#include <QAudioDevice>
#include <QAudioFormat>
#include <QAudioSource>
#include <QMediaDevices>
#endif

namespace {
constexpr int kWhisperRate = 16000;
constexpr int kLimitMs = 120000;

QStringList defaultCommand()
{
    return { QStringLiteral("luna-send"), QStringLiteral("-n"), QStringLiteral("1"),
             QStringLiteral("luna://org.webosphoenix.transcriber/transcribe"),
             QStringLiteral("{\"path\":\"%f\"}") };
}
} // namespace

Dictation::Dictation(QObject *parent)
    : QObject(parent), m_command(defaultCommand())
{
    m_limit = new QTimer(this);
    m_limit->setSingleShot(true);
    m_limit->setInterval(kLimitMs);
    connect(m_limit, &QTimer::timeout, this, &Dictation::stop);
}

Dictation::~Dictation()
{
    cancel();
}

bool Dictation::available() const
{
#ifdef PHOENIX_HAVE_MULTIMEDIA
    return true;
#else
    return false;
#endif
}

void Dictation::setCommand(const QStringList &c)
{
    if (c == m_command)
        return;
    m_command = c.isEmpty() ? defaultCommand() : c;
    emit commandChanged();
}

void Dictation::setLanguage(const QString &l)
{
    if (l == m_language)
        return;
    m_language = l;
    emit languageChanged();
}

void Dictation::start()
{
    if (m_listening || m_busy)
        return;
#ifdef PHOENIX_HAVE_MULTIMEDIA
    const QAudioDevice device = QMediaDevices::defaultAudioInput();
    if (device.isNull()) {
        emit transcribed(QString(), tr("There is no microphone."));
        return;
    }
    // 16 kHz mono if the microphone takes it; otherwise its own format,
    // converted when the recording ends.
    QAudioFormat format;
    format.setSampleRate(kWhisperRate);
    format.setChannelCount(1);
    format.setSampleFormat(QAudioFormat::Int16);
    if (!device.isFormatSupported(format))
        format = device.preferredFormat();
    if (format.sampleFormat() != QAudioFormat::Int16 && format.sampleFormat() != QAudioFormat::Float) {
        format.setSampleFormat(QAudioFormat::Int16);
        if (!device.isFormatSupported(format)) {
            emit transcribed(QString(), tr("The microphone's sound format is not supported."));
            return;
        }
    }
    m_channels = format.channelCount();
    m_rate = format.sampleRate();
    m_float = format.sampleFormat() == QAudioFormat::Float;
    m_pcm.clear();
    m_source = new QAudioSource(device, format, this);
    m_io = m_source->start();
    if (!m_io) {
        delete m_source;
        m_source = nullptr;
        emit transcribed(QString(), tr("The microphone could not be opened."));
        return;
    }
    connect(m_io, &QIODevice::readyRead, this, [this]() {
        if (m_io)
            m_pcm.append(m_io->readAll());
    });
    m_listening = true;
    m_limit->start();
    emit stateChanged();
#else
    emit transcribed(QString(), tr("Dictation is not available on this device."));
#endif
}

void Dictation::stop()
{
    if (m_listening)
        finishRecording(true);
}

void Dictation::cancel()
{
    if (m_listening)
        finishRecording(false);
    if (m_process) {
        m_process->disconnect(this);
        m_process->kill();
        m_process->deleteLater();
        m_process = nullptr;
        m_busy = false;
        emit stateChanged();
    }
}

void Dictation::finishRecording(bool transcribe)
{
#ifdef PHOENIX_HAVE_MULTIMEDIA
    m_limit->stop();
    if (m_io)
        m_pcm.append(m_io->readAll());
    if (m_source) {
        m_source->stop();
        m_source->deleteLater();
    }
    m_source = nullptr;
    m_io = nullptr;
#endif
    m_listening = false;
    if (!transcribe) {
        m_pcm.clear();
        emit stateChanged();
        return;
    }
    const QByteArray pcm = toWhisperPcm(m_pcm, m_channels, m_rate, m_float);
    m_pcm.clear();
    if (pcm.size() < kWhisperRate / 4 * 2) {          // under a quarter of a second
        emit stateChanged();
        emit transcribed(QString(), tr("Nothing was heard."));
        return;
    }
    QTemporaryFile file(QDir::tempPath() + QStringLiteral("/phoenix-dictation-XXXXXX.wav"));
    file.setAutoRemove(false);
    if (!file.open() || file.write(wav(pcm, kWhisperRate)) < 0) {
        emit stateChanged();
        emit transcribed(QString(), tr("The recording could not be saved."));
        return;
    }
    file.close();
    m_busy = true;
    emit stateChanged();
    runTranscriber(file.fileName(), true);
}

void Dictation::transcribeFile(const QString &file)
{
    if (m_listening || m_busy)
        return;
    m_busy = true;
    emit stateChanged();
    runTranscriber(file, false);
}

void Dictation::runTranscriber(const QString &file, bool removeAfter)
{
    QStringList args;
    for (const QString &a : m_command) {
        QString s = a;
        s.replace(QLatin1String("%f"), file);
        s.replace(QLatin1String("%l"), m_language.isEmpty() ? QStringLiteral("en") : m_language);
        args << s;
    }
    const QString program = args.takeFirst();
    m_process = new QProcess(this);
    QProcess *proc = m_process;
    connect(proc, &QProcess::finished, this, [this, proc, file, removeAfter](int exitCode, QProcess::ExitStatus) {
        const auto reply = parseReply(proc->readAllStandardOutput(), exitCode);
        if (removeAfter)
            QFile::remove(file);
        proc->deleteLater();
        if (m_process == proc)
            m_process = nullptr;
        m_busy = false;
        emit stateChanged();
        emit transcribed(reply.first, reply.second);
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc, file, program, removeAfter](QProcess::ProcessError e) {
        if (e != QProcess::FailedToStart)
            return;
        if (removeAfter)
            QFile::remove(file);
        proc->deleteLater();
        if (m_process == proc)
            m_process = nullptr;
        m_busy = false;
        emit stateChanged();
        emit transcribed(QString(), tr("Speech recognition is not installed (%1 could not be started).").arg(program));
    });
    proc->start(program, args);
}

QPair<QString, QString> Dictation::parseReply(const QByteArray &out, int exitCode)
{
    // The last JSON object in the output (luna-send may print more lines).
    const int start = out.indexOf('{');
    const QJsonDocument doc = QJsonDocument::fromJson(start >= 0 ? out.mid(start) : out);
    const QJsonObject o = doc.object();
    if (o.value(QStringLiteral("returnValue")).toBool(exitCode == 0) && o.contains(QStringLiteral("text")))
        return { o.value(QStringLiteral("text")).toString().trimmed(), QString() };
    const QString err = o.value(QStringLiteral("errorText")).toString();
    return { QString(), err.isEmpty() ? QObject::tr("Speech recognition failed.") : err };
}

QByteArray Dictation::toWhisperPcm(const QByteArray &in, int channels, int rate, bool isFloat)
{
    channels = qMax(1, channels);
    const int bytes = isFloat ? 4 : 2;
    const qsizetype frames = in.size() / (bytes * channels);
    if (channels == 1 && rate == kWhisperRate && !isFloat)
        return in.left(frames * 2);
    // Mono, as floats.
    QVector<float> mono(frames);
    for (qsizetype i = 0; i < frames; ++i) {
        float sum = 0;
        for (int c = 0; c < channels; ++c) {
            const char *p = in.constData() + (i * channels + c) * bytes;
            if (isFloat) {
                float f;
                std::memcpy(&f, p, 4);
                sum += f;
            } else {
                sum += qFromLittleEndian<qint16>(p) / 32768.0f;
            }
        }
        mono[i] = sum / channels;
    }
    // 16 kHz, linear interpolation.
    const qsizetype outFrames = rate > 0 ? frames * kWhisperRate / rate : 0;
    QByteArray out(outFrames * 2, Qt::Uninitialized);
    for (qsizetype j = 0; j < outFrames; ++j) {
        const double pos = double(j) * rate / kWhisperRate;
        const qsizetype a = qsizetype(pos);
        const qsizetype b = qMin(a + 1, frames - 1);
        const float t = float(pos - a);
        const float v = qBound(-1.0f, mono[a] * (1 - t) + mono[b] * t, 1.0f);
        qToLittleEndian<qint16>(qint16(v * 32767), out.data() + j * 2);
    }
    return out;
}

QByteArray Dictation::wav(const QByteArray &pcm16, int rate)
{
    QByteArray h(44, 0);
    char *d = h.data();
    std::memcpy(d, "RIFF", 4);
    qToLittleEndian<quint32>(quint32(36 + pcm16.size()), d + 4);
    std::memcpy(d + 8, "WAVEfmt ", 8);
    qToLittleEndian<quint32>(16, d + 16);
    qToLittleEndian<quint16>(1, d + 20);                // PCM
    qToLittleEndian<quint16>(1, d + 22);                // mono
    qToLittleEndian<quint32>(quint32(rate), d + 24);
    qToLittleEndian<quint32>(quint32(rate * 2), d + 28);
    qToLittleEndian<quint16>(2, d + 32);
    qToLittleEndian<quint16>(16, d + 34);
    std::memcpy(d + 36, "data", 4);
    qToLittleEndian<quint32>(quint32(pcm16.size()), d + 40);
    return h + pcm16;
}
