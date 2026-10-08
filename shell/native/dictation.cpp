// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "dictation.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QTemporaryFile>
#include <QTimer>
#include <QtEndian>

#include <cmath>
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
// EndOfSpeech: what counts as speech (RMS of full scale), how much of it,
// and the quiet that ends it.
constexpr double kSpeechLevel = 0.02;
constexpr int kSpeechMinMs = 150;
constexpr int kQuietEndMs = 1000;
constexpr int kNoSpeechMs = 7000;
constexpr int kFileChunkMs = 50;
constexpr int kRingSeconds = 4;
constexpr double kPhraseLeadS = 0.3;   // recorded before the phrase's start      // standing by: what the spotter had, for the words after the phrase

QStringList defaultCommand()
{
    return { QStringLiteral("luna-send"), QStringLiteral("-n"), QStringLiteral("1"),
             QStringLiteral("luna://org.webosphoenix.transcriber/transcribe"),
             QStringLiteral("{\"path\":\"%f\",\"prompt\":\"%p\"}") };
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
    m_standby = false;
    m_wakeWord = false;
    cancel();
    stopSpotter();
    if (m_capturing)
        closeCapture();
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

void Dictation::setPrompt(const QString &p)
{
    if (p == m_prompt)
        return;
    m_prompt = p;
    emit promptChanged();
}

void Dictation::setAutoStop(bool a)
{
    if (a == m_autoStop)
        return;
    m_autoStop = a;
    emit autoStopChanged();
}

void Dictation::setInputFiles(const QStringList &f)
{
    if (f == m_inputFiles)
        return;
    m_inputFiles = f;
    m_nextInput = 0;
    emit inputFilesChanged();
}

void Dictation::setWakeCommand(const QStringList &c)
{
    if (c == m_wakeCommand)
        return;
    stopSpotter();
    m_wakeCommand = c;
    setWakeError(QString());
    emit wakeCommandChanged();
    updateStandby();
}

void Dictation::setStandby(bool s)
{
    if (s == m_standby)
        return;
    m_standby = s;
    emit standbyChanged();
    updateStandby();
}

void Dictation::setWakeError(const QString &e)
{
    if (e == m_wakeError)
        return;
    m_wakeError = e;
    emit wakeErrorChanged();
}

// The spotter runs while the wake word is on (its model stays loaded);
// standing by, the microphone is open for it while nothing records; else,
// between recordings, the microphone is closed.
void Dictation::updateStandby()
{
    const bool on = m_wakeWord && wakeAvailable() && m_wakeError.isEmpty();
    if (on && !m_spotter)
        startSpotter();
    else if (!on)
        stopSpotter();
    if (on && m_standby) {
        if (!m_capturing && !m_listening) {
            QString error;
            if (!openCapture(true, &error))
                setWakeError(error);
            emit stateChanged();
        }
    } else if (m_capturing && !m_listening) {
        closeCapture();
        emit stateChanged();
    }
}

void Dictation::setWakeWord(bool w)
{
    if (w == m_wakeWord)
        return;
    m_wakeWord = w;
    if (w)
        setWakeError(QString());          // another try
    emit wakeWordChanged();
    updateStandby();
}

void Dictation::startSpotter()
{
    m_spotter = new QProcess(this);
    QProcess *proc = m_spotter;
    m_spotterLine.clear();
    m_spotterFed = 0;
    m_ring.clear();
    m_ringStart = 0;
    proc->setProcessChannelMode(QProcess::SeparateChannels);
    connect(proc, &QProcess::readyReadStandardOutput, this, &Dictation::spotterOutput);
    connect(proc, &QProcess::finished, this, [this, proc](int code, QProcess::ExitStatus) {
        proc->deleteLater();
        if (m_spotter != proc)
            return;
        spotterOutput();
        m_spotter = nullptr;
        if (m_wakeError.isEmpty())
            setWakeError(code ? tr("The wake word stopped (exit code %1).").arg(code) : tr("The wake word stopped."));
        updateStandby();
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError e) {
        if (e != QProcess::FailedToStart || m_spotter != proc)
            return;
        proc->deleteLater();
        m_spotter = nullptr;
        setWakeError(tr("The wake word is not installed (%1 could not be started).").arg(m_wakeCommand.value(0)));
        updateStandby();
    });
    QStringList args = m_wakeCommand;
    const QString program = args.takeFirst();
    proc->start(program, args);
}

void Dictation::stopSpotter()
{
    if (!m_spotter)
        return;
    QProcess *proc = m_spotter;
    m_spotter = nullptr;
    proc->disconnect(this);
    proc->closeWriteChannel();
    proc->kill();
    proc->waitForFinished(1000);
    proc->deleteLater();
}

// The spotter's lines: {"ready"}, {"wake", "end", "heard"}, {"error"}.
void Dictation::spotterOutput()
{
    if (!m_spotter)
        return;
    m_spotterLine += m_spotter->readAllStandardOutput();
    qsizetype nl;
    while ((nl = m_spotterLine.indexOf('\n')) >= 0) {
        const QByteArray line = m_spotterLine.left(nl);
        m_spotterLine.remove(0, nl + 1);
        const QJsonObject o = QJsonDocument::fromJson(line).object();
        if (o.contains(QStringLiteral("error"))) {
            setWakeError(o.value(QStringLiteral("error")).toString());
            continue;
        }
        if (!o.contains(QStringLiteral("wake")) || m_listening || m_busy || !standbyWanted())
            continue;
        // The phrase and what was said after it, kept for a recording
        // started now. From the phrase's start: where it ends is less sure
        // (a word run on, "Phoenix, text Sam", lost its "t"), and the
        // transcript of the phrase is easily dropped (withoutWakeWord).
        // A little before it too: the spotter's word times are a guess,
        // and a clipped "hey" can take the next word with it ("Karl
        // Marcus").
        const qint64 at = qint64((o.value(QStringLiteral("start")).toDouble() - kPhraseLeadS) * kWhisperRate);
        const qint64 from = qBound<qint64>(0, at - m_ringStart, m_ring.size() / 2);
        m_preroll = m_ring.mid(from * 2);
        m_inWake = true;
        emit wakeHeard(o.value(QStringLiteral("heard")).toString());
        m_inWake = false;
        m_preroll.clear();
    }
}

// Opens the microphone, or the next file (nextFile) or the one playing.
bool Dictation::openCapture(bool standby, QString *error)
{
    if (!m_inputFiles.isEmpty()) {
        // A file as the microphone: in real time, a stretch every 50 ms,
        // then quiet. Standing by plays only files not yet played.
        if (!standby || m_nextInput < m_inputFiles.size()) {
            if (!loadFile(error))
                return false;
        } else {
            m_fileWav = Wav();
            m_fileWav.ok = true;
            m_rate = kWhisperRate;
            m_channels = 1;
            m_float = false;
            m_fileDone = true;
        }
        if (!m_fileTimer) {
            m_fileTimer = new QTimer(this);
            m_fileTimer->setInterval(kFileChunkMs);
            connect(m_fileTimer, &QTimer::timeout, this, [this]() {
                const qsizetype bytes = qsizetype(m_rate) * kFileChunkMs / 1000 * m_channels * (m_float ? 4 : 2);
                QByteArray chunk = m_fileWav.pcm.mid(m_filePos, bytes);
                m_filePos += chunk.size();
                if (chunk.size() < bytes) {
                    m_fileDone = true;
                    chunk.append(QByteArray(bytes - chunk.size(), 0));
                }
                recorded(chunk);
            });
        }
        m_capturing = true;
        m_fileTimer->start();
        return true;
    }
#ifdef PHOENIX_HAVE_MULTIMEDIA
    const QAudioDevice device = QMediaDevices::defaultAudioInput();
    if (device.isNull()) {
        *error = tr("There is no microphone.");
        return false;
    }
    // 16 kHz mono if the microphone takes it; otherwise its own format,
    // converted as it comes.
    QAudioFormat format;
    format.setSampleRate(kWhisperRate);
    format.setChannelCount(1);
    format.setSampleFormat(QAudioFormat::Int16);
    if (!device.isFormatSupported(format))
        format = device.preferredFormat();
    if (format.sampleFormat() != QAudioFormat::Int16 && format.sampleFormat() != QAudioFormat::Float) {
        format.setSampleFormat(QAudioFormat::Int16);
        if (!device.isFormatSupported(format)) {
            *error = tr("The microphone's sound format is not supported.");
            return false;
        }
    }
    m_channels = format.channelCount();
    m_rate = format.sampleRate();
    m_float = format.sampleFormat() == QAudioFormat::Float;
    m_source = new QAudioSource(device, format, this);
    m_io = m_source->start();
    if (!m_io) {
        delete m_source;
        m_source = nullptr;
        *error = tr("The microphone could not be opened.");
        return false;
    }
    connect(m_io, &QIODevice::readyRead, this, [this]() {
        if (m_io)
            recorded(m_io->readAll());
    });
    m_capturing = true;
    return true;
#else
    Q_UNUSED(standby);
    *error = tr("Dictation is not available on this device.");
    return false;
#endif
}

// The next microphone file (the last one again after them all).
bool Dictation::loadFile(QString *error)
{
    const QString name = m_inputFiles.at(qMin<qsizetype>(m_nextInput, m_inputFiles.size() - 1));
    ++m_nextInput;
    QFile f(name);
    m_fileWav = f.open(QIODevice::ReadOnly) ? readWav(f.readAll()) : Wav();
    if (!m_fileWav.ok) {
        *error = tr("The microphone file %1 is not a WAV recording.").arg(name);
        return false;
    }
    m_channels = m_fileWav.channels;
    m_rate = m_fileWav.rate;
    m_float = m_fileWav.isFloat;
    m_filePos = 0;
    m_fileDone = false;
    return true;
}

void Dictation::closeCapture()
{
    if (m_fileTimer)
        m_fileTimer->stop();
#ifdef PHOENIX_HAVE_MULTIMEDIA
    if (m_io)
        recorded(m_io->readAll());
    if (m_source) {
        m_source->stop();
        m_source->deleteLater();
    }
    m_source = nullptr;
    m_io = nullptr;
#endif
    m_capturing = false;
    m_inject.clear();
}

bool Dictation::hear(const QString &file)
{
    if (!m_capturing)
        return false;
    QFile f(file);
    const Wav w = f.open(QIODevice::ReadOnly) ? readWav(f.readAll()) : Wav();
    if (!w.ok)
        return false;
    m_inject += toWhisperPcm(w.pcm, w.channels, w.rate, w.isFloat);
    return true;
}

void Dictation::start()
{
    if (m_listening || m_busy)
        return;
    m_end = EndOfSpeech();
    m_pcm.clear();
    QString error;
    if (m_capturing) {
        // Open already, standing by: after the wake word, on from the end
        // of the phrase (the same file); else a recording of its own (the
        // next file).
        if (m_inWake) {
            m_pcm = m_preroll;
            for (qsizetype i = 0; i < m_pcm.size(); i += kWhisperRate / 1000 * kFileChunkMs * 2) {
                const QByteArray part = m_pcm.mid(i, kWhisperRate / 1000 * kFileChunkMs * 2);
                m_end.feed(level(part, 1, false), int(part.size() / 2 * 1000 / kWhisperRate));
            }
        } else if (!m_inputFiles.isEmpty() && !loadFile(&error)) {
            emit transcribed(QString(), error);
            return;
        }
    } else if (!openCapture(false, &error)) {
        emit transcribed(QString(), error);
        return;
    }
    m_listening = true;
    m_limit->start();
    emit stateChanged();
}

// A stretch from the microphone: to the recording (with autoStop, the end
// of speech ends it), or, standing by, to the wake word's spotter.
void Dictation::recorded(const QByteArray &raw)
{
    if (raw.isEmpty())
        return;
    QByteArray chunk = toWhisperPcm(raw, m_channels, m_rate, m_float);
    if (!m_inject.isEmpty()) {
        const qsizetype n = qMin(chunk.size(), m_inject.size()) / 2;
        for (qsizetype i = 0; i < n; ++i) {
            const int v = qFromLittleEndian<qint16>(chunk.constData() + i * 2) + qFromLittleEndian<qint16>(m_inject.constData() + i * 2);
            qToLittleEndian<qint16>(qint16(qBound(-32768, v, 32767)), chunk.data() + i * 2);
        }
        m_inject.remove(0, n * 2);
    }
    if (!m_listening) {
        if (m_spotter && standbyWanted() && !m_busy && m_spotter->state() == QProcess::Running) {
            m_spotter->write(chunk);
            m_spotterFed += chunk.size() / 2;
            m_ring += chunk;
            const qsizetype keep = kWhisperRate * 2 * kRingSeconds;
            if (m_ring.size() > keep + kWhisperRate * 2)
                m_ring.remove(0, m_ring.size() - keep);
            m_ringStart = m_spotterFed - m_ring.size() / 2;
        }
        return;
    }
    m_pcm.append(chunk);
    const double lvl = level(chunk, 1, false);
    setLoudness(loudnessOf(lvl));
    if (!m_autoStop)
        return;
    const int ms = int(chunk.size() / 2 * 1000 / kWhisperRate);
    switch (m_end.feed(lvl, ms)) {
    case EndOfSpeech::Ended:
        QMetaObject::invokeMethod(this, &Dictation::stop, Qt::QueuedConnection);
        break;
    case EndOfSpeech::NothingHeard:
        QMetaObject::invokeMethod(this, [this]() {
            if (!m_listening)
                return;
            finishRecording(false);
            emit transcribed(QString(), tr("Nothing was heard."));
        }, Qt::QueuedConnection);
        break;
    case EndOfSpeech::Going:
        break;
    }
}

Dictation::EndOfSpeech::Result Dictation::EndOfSpeech::feed(double level, int ms)
{
    totalMs += ms;
    if (level >= kSpeechLevel) {
        speechMs += ms;
        quietMs = 0;
    } else if (speechMs >= kSpeechMinMs) {
        quietMs += ms;
    } else {
        speechMs = 0;                                  // a click, not speech
    }
    if (speechMs >= kSpeechMinMs && quietMs >= kQuietEndMs)
        return Ended;
    if (speechMs < kSpeechMinMs && totalMs >= kNoSpeechMs)
        return NothingHeard;
    return Going;
}

double Dictation::level(const QByteArray &in, int channels, bool isFloat)
{
    const int bytes = isFloat ? 4 : 2;
    const qsizetype n = in.size() / bytes / qMax(1, channels) * qMax(1, channels);
    if (n <= 0)
        return 0;
    double sum = 0;
    for (qsizetype i = 0; i < n; ++i) {
        const char *p = in.constData() + i * bytes;
        float v;
        if (isFloat)
            std::memcpy(&v, p, 4);
        else
            v = qFromLittleEndian<qint16>(p) / 32768.0f;
        sum += double(v) * v;
    }
    return std::sqrt(sum / n);
}

double Dictation::loudnessOf(double level)
{
    if (level <= 0)
        return 0;
    const double db = 20 * std::log10(level);
    return qBound(0.0, (db + 50) / 40, 1.0);
}

void Dictation::setLoudness(qreal l)
{
    if (qFuzzyCompare(l + 1, m_loudness + 1))
        return;
    m_loudness = l;
    emit loudnessChanged();
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
    m_limit->stop();
    m_listening = false;
    // Standing by goes on with the microphone open; else it closes.
    if (standbyWanted()) {
#ifdef PHOENIX_HAVE_MULTIMEDIA
        if (m_io)
            m_pcm.append(toWhisperPcm(m_io->readAll(), m_channels, m_rate, m_float));
#endif
    } else {
        m_listening = true;              // the last of it still goes to the recording
        closeCapture();
        m_listening = false;
    }
    setLoudness(0);
    if (!transcribe) {
        m_pcm.clear();
        emit stateChanged();
        return;
    }
    const QByteArray pcm = m_pcm;
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
    QStringList args = commandLine(m_command, file, m_language, m_prompt);
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

QStringList Dictation::commandLine(const QStringList &command, const QString &file, const QString &language,
                                   const QString &prompt)
{
    const auto escaped = [](const QString &v) {
        const QByteArray j = QJsonDocument(QJsonArray{ v }).toJson(QJsonDocument::Compact);   // ["..."]
        return QString::fromUtf8(j.mid(2, j.size() - 4));
    };
    const QString lang = language.isEmpty() ? QStringLiteral("en") : language;
    QStringList args;
    for (const QString &a : command) {
        const bool json = a.trimmed().startsWith(QLatin1Char('{'));
        QString s = a;
        // One pass, so a value that has "%p" in it stays as it is.
        QString out;
        for (qsizetype i = 0; i < s.size(); ++i) {
            if (s.at(i) == QLatin1Char('%') && i + 1 < s.size()) {
                const QChar c = s.at(i + 1);
                const QString *v = c == QLatin1Char('f') ? &file : c == QLatin1Char('l') ? &lang
                                 : c == QLatin1Char('p') ? &prompt : nullptr;
                if (v) {
                    out += json ? escaped(*v) : *v;
                    ++i;
                    continue;
                }
            }
            out += s.at(i);
        }
        args << out;
    }
    return args;
}

Dictation::Wav Dictation::readWav(const QByteArray &d)
{
    Wav w;
    if (d.size() < 12 || !d.startsWith("RIFF") || d.mid(8, 4) != "WAVE")
        return w;
    int format = 0, bits = 0;
    bool haveFmt = false;
    qsizetype pos = 12;
    while (pos + 8 <= d.size()) {
        const QByteArray id = d.mid(pos, 4);
        const quint32 len = qFromLittleEndian<quint32>(d.constData() + pos + 4);
        const qsizetype body = pos + 8;
        if (id == "fmt " && len >= 16 && body + 16 <= d.size()) {
            format = qFromLittleEndian<quint16>(d.constData() + body);
            w.channels = qFromLittleEndian<quint16>(d.constData() + body + 2);
            w.rate = int(qFromLittleEndian<quint32>(d.constData() + body + 4));
            bits = qFromLittleEndian<quint16>(d.constData() + body + 14);
            if (format == 0xFFFE && len >= 26)          // WAVE_FORMAT_EXTENSIBLE: the subformat's first two bytes
                format = qFromLittleEndian<quint16>(d.constData() + body + 24);
            haveFmt = true;
        } else if (id == "data") {
            w.pcm = d.mid(body, qMin<qsizetype>(len, d.size() - body));
            break;
        }
        pos = body + len + (len & 1);
    }
    w.isFloat = format == 3 && bits == 32;
    w.ok = haveFmt && w.channels > 0 && w.rate > 0 && ((format == 1 && bits == 16) || w.isFloat) && !w.pcm.isEmpty();
    return w;
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
