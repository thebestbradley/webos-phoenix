// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Dictation's recording format and the transcriber's replies, without a
// microphone (CI: build/dictation-test).

#include "dictation.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QTemporaryFile>
#include <QtEndian>
#include <cmath>
#include <cstdio>
#include <cstring>

static int failures = 0;
static void check(bool ok, const char *what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok)
        ++failures;
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);

    // A 16 kHz mono WAV header around the samples.
    QByteArray pcm(3200, 0);
    const QByteArray w = Dictation::wav(pcm, 16000);
    check(w.size() == 44 + 3200 && w.startsWith("RIFF") && w.mid(8, 8) == "WAVEfmt ", "a WAV file");
    check(qFromLittleEndian<quint32>(w.constData() + 24) == 16000 && qFromLittleEndian<quint16>(w.constData() + 22) == 1
          && qFromLittleEndian<quint16>(w.constData() + 34) == 16, "16 kHz, mono, 16-bit");
    check(qFromLittleEndian<quint32>(w.constData() + 40) == 3200 && qFromLittleEndian<quint32>(w.constData() + 4) == 36 + 3200,
          "its sizes");

    // 48 kHz stereo float (a laptop microphone) to 16 kHz mono 16-bit.
    const int frames = 4800;
    QByteArray f(frames * 2 * 4, 0);
    for (int i = 0; i < frames; ++i) {
        const float v = 0.5f * std::sin(2 * M_PI * 440 * i / 48000.0);
        std::memcpy(f.data() + (i * 2) * 4, &v, 4);
        std::memcpy(f.data() + (i * 2 + 1) * 4, &v, 4);
    }
    const QByteArray out = Dictation::toWhisperPcm(f, 2, 48000, true);
    check(out.size() == 1600 * 2, "a tenth of a second at 16 kHz");
    int peak = 0;
    for (int i = 0; i < 1600; ++i)
        peak = qMax(peak, qAbs(int(qFromLittleEndian<qint16>(out.constData() + i * 2))));
    check(peak > 15000 && peak < 17000, "the level kept (half of full scale)");
    // Already 16 kHz mono 16-bit: as it is.
    check(Dictation::toWhisperPcm(pcm, 1, 16000, false) == pcm, "16 kHz mono 16-bit unchanged");

    // The transcriber's reply.
    auto r = Dictation::parseReply("{\"returnValue\":true,\"text\":\" Hello there. \",\"state\":\"done\"}\n", 0);
    check(r.first == QStringLiteral("Hello there.") && r.second.isEmpty(), "a transcript");
    r = Dictation::parseReply("{\"returnValue\":false,\"errorCode\":2,\"errorText\":\"Speech recognition is not installed\"}", 1);
    check(r.first.isEmpty() && r.second == QStringLiteral("Speech recognition is not installed"), "an error");
    r = Dictation::parseReply("garbage", 1);
    check(r.first.isEmpty() && !r.second.isEmpty(), "no reply");

    // The transcriber's command line: %f, %l, %p; JSON-escaped in a JSON payload.
    const QString prompt = QStringLiteral("Ada Palmer, \"Sam\" Delgado");
    QStringList cl = Dictation::commandLine({ QStringLiteral("node"), QStringLiteral("cli.js"), QStringLiteral("%f"),
                                              QStringLiteral("%l"), QStringLiteral("%p") },
                                            QStringLiteral("/tmp/a.wav"), QString(), prompt);
    check(cl == QStringList({ "node", "cli.js", "/tmp/a.wav", "en", prompt }), "command arguments as they are");
    cl = Dictation::commandLine({ QStringLiteral("luna-send"), QStringLiteral("{\"path\":\"%f\",\"prompt\":\"%p\"}") },
                                QStringLiteral("/tmp/a.wav"), QStringLiteral("de"), prompt);
    check(cl.value(1) == QStringLiteral("{\"path\":\"/tmp/a.wav\",\"prompt\":\"Ada Palmer, \\\"Sam\\\" Delgado\"}"),
          "a JSON payload's values escaped");
    cl = Dictation::commandLine({ QStringLiteral("%p") }, QString(), QString(), QStringLiteral("100%f"));
    check(cl == QStringList({ "100%f" }), "a value's own % is left alone");

    // Reading a WAV (the --microphone-file).
    QByteArray tone(16000 * 2 / 2, 0);                                     // half a second at 16 kHz
    for (int i = 0; i < tone.size() / 2; ++i)
        qToLittleEndian<qint16>(qint16(8000 * std::sin(2 * M_PI * 300 * i / 16000.0)), tone.data() + i * 2);
    Dictation::Wav wv = Dictation::readWav(Dictation::wav(tone, 16000));
    check(wv.ok && wv.rate == 16000 && wv.channels == 1 && !wv.isFloat && wv.pcm == tone, "a WAV file read back");
    check(!Dictation::readWav("RIFF....WAVEjunk").ok && !Dictation::readWav("not a wav").ok, "anything else is not");

    // Loudness, and the end of speech.
    check(Dictation::level(QByteArray(3200, 0), 1, false) == 0, "silence is level 0");
    const double toneLevel = Dictation::level(tone, 1, false);
    check(toneLevel > 0.15 && toneLevel < 0.19, "a tone at a quarter of full scale: RMS about 0.17");
    check(Dictation::loudnessOf(0) == 0 && Dictation::loudnessOf(0.001) == 0, "-60 dBFS and silence: loudness 0");
    check(std::abs(Dictation::loudnessOf(0.01) - 0.25) < 1e-9 && Dictation::loudnessOf(0.5) == 1,
          "-40 dBFS a quarter, -6 dBFS full");
    Dictation::EndOfSpeech eos;
    auto r2 = Dictation::EndOfSpeech::Going;
    for (int i = 0; i < 10; ++i)                                          // half a second of speech
        r2 = eos.feed(0.2, 50);
    for (int i = 0; i < 19; ++i)                                          // 950 ms of quiet
        r2 = eos.feed(0.001, 50);
    check(r2 == Dictation::EndOfSpeech::Going, "speech, then under a second of quiet: still listening");
    check(eos.feed(0.001, 50) == Dictation::EndOfSpeech::Ended, "a second of quiet ends it");
    Dictation::EndOfSpeech quiet;
    r2 = Dictation::EndOfSpeech::Going;
    for (int i = 0; i < 139 && r2 == Dictation::EndOfSpeech::Going; ++i)
        r2 = quiet.feed(i == 20 ? 0.3 : 0.001, 50);                         // one click, no speech
    check(r2 == Dictation::EndOfSpeech::Going, "a click is not speech");
    check(quiet.feed(0.001, 50) == Dictation::EndOfSpeech::NothingHeard, "7 seconds without speech: nothing heard");

    // A file as the microphone, ending by itself, with the prompt passed on.
    {
        QTemporaryFile wavFile(QDir::tempPath() + QStringLiteral("/dictation-test-XXXXXX.wav"));
        wavFile.open();
        wavFile.write(Dictation::wav(tone, 16000));
        wavFile.close();
        Dictation d;
        d.setInputFiles({ wavFile.fileName(), QStringLiteral("/nonexistent.wav") });
        d.setAutoStop(true);
        d.setPrompt(QStringLiteral("Call Ada Palmer"));
        d.setCommand({ QStringLiteral("/bin/echo"), QStringLiteral("{\"returnValue\":true,\"text\":\"%p\"}") });
        QString heard, error;
        bool done = false;
        qreal loudest = 0;
        QObject::connect(&d, &Dictation::transcribed, [&](const QString &t, const QString &e) { heard = t; error = e; done = true; });
        QObject::connect(&d, &Dictation::loudnessChanged, [&]() { loudest = qMax(loudest, d.loudness()); });
        QElapsedTimer clock;
        clock.start();
        d.start();
        check(d.listening(), "listening to the file");
        while (!done && clock.elapsed() < 6000)
            QCoreApplication::processEvents(QEventLoop::WaitForMoreEvents, 50);
        check(done && error.isEmpty() && heard == QStringLiteral("Call Ada Palmer"),
              "it stops by itself after the speech and transcribes (the prompt reached the transcriber)");
        check(clock.elapsed() >= 1400 && clock.elapsed() < 4000, "about a second after the speech ended");
        check(loudest > 0.82 && loudest < 0.92 && d.loudness() == 0,
              "the tone (-15 dBFS) was loud while listening, and quiet after");

        done = false;
        d.start();                                     // the second recording: the next file
        check(done && !error.isEmpty() && !d.listening(), "a missing microphone file is an error");
        done = false;
        d.start();                                     // and the last one again
        check(done && error.contains(QStringLiteral("nonexistent")), "the last file again after that");
    }

    std::printf(failures ? "%d failed\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
