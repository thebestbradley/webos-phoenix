// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-tts: speaks the text on its standard input (or its arguments)
// with Kitten TTS, the Assistant's voice (docs/AI-AND-MCP.md, Speech). The
// shell's Speech (shell/native/speech.cpp) and the device's
// org.webosphoenix.tts (apps/assistant/service/lib/node-device.js) run it
// for each answer, as they run Flite or espeak-ng where it is missing;
// stopping is ending the process.
//
//   phoenix-tts [--model DIR] [--voice NAME] [--speed X] [--onnxruntime LIB]
//               [--lexicon FILE] [--phonemizer auto|lexicon|espeak]
//               [--out FILE.wav] [--phonemes] [--check] [--quiet] [TEXT ...]
//
// It speaks sentence by sentence: the first is heard while the next is
// made. At the end it writes one line on its standard error, what it did
// and how fast ("phoenix-tts: Kitten ... real-time factor 0.3"); the
// simulator's log shows it.
//
//   --model DIR       config.json, the .onnx model and voices.npz (default:
//                     $PHOENIX_TTS_MODEL, else kitten/ beside this program,
//                     else /usr/share/phoenix/kitten)
//   --voice NAME      expr-voice-3-f (default) or another of the model's
//   --onnxruntime LIB libonnxruntime (default: $PHOENIX_ONNXRUNTIME, else
//                     one in the model's folder, else the system's)
//   --lexicon FILE    the CMU Pronouncing Dictionary (default: cmudict.dict
//                     in the model's folder)
//   --phonemizer      lexicon: the dictionary (permissive, the default);
//                     espeak: the espeak-ng program (GPL-3.0, run as a
//                     program of its own, exactly what Kitten was trained
//                     on); auto: espeak-ng when it is installed, else the
//                     dictionary
//   --out FILE.wav    write the speech to a file instead of playing it
//   --phonemes        only print the phonemes, a line per sentence
//   --check           whether it can speak: {"ok":true,"voices":[...],...}
//                     or {"ok":false,"error":"..."} (exit status 3)
//
// Exit status: 0 spoken, 1 bad arguments, 3 Kitten cannot speak here (the
// model, ONNX Runtime or the dictionary missing: the caller speaks with
// its fallback), 4 no sound output.

#include "audio.h"
#include "json.h"
#include "kitten.h"
#include "phonemes.h"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iostream>
#include <iterator>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
#include <vector>

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

using namespace phoenix;
using namespace phoenix::tts;

namespace {

const char *const DEFAULT_VOICE = "expr-voice-3-f";

bool exists(const std::string &p)
{
    struct stat st;
    return !p.empty() && stat(p.c_str(), &st) == 0;
}

std::string selfDir()
{
    char buf[4096] = {};
#ifdef __APPLE__
    uint32_t size = sizeof buf;
    if (_NSGetExecutablePath(buf, &size) != 0)
        return ".";
#else
    const ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
    if (n <= 0)
        return ".";
    buf[n] = 0;
#endif
    std::string p(buf);
    const size_t slash = p.rfind('/');
    return slash == std::string::npos ? "." : p.substr(0, slash);
}

std::string findProgram(const std::string &name)
{
    const char *path = std::getenv("PATH");
    std::string dirs = path ? path : "/usr/bin:/bin";
    for (size_t a = 0; a <= dirs.size();) {
        size_t b = dirs.find(':', a);
        if (b == std::string::npos)
            b = dirs.size();
        const std::string p = dirs.substr(a, b - a) + "/" + name;
        if (b > a && access(p.c_str(), X_OK) == 0)
            return p;
        a = b + 1;
    }
    return std::string();
}

void usage()
{
    std::fprintf(stderr, "usage: phoenix-tts [--model DIR] [--voice NAME] [--speed X] [--onnxruntime LIB] [--lexicon FILE]\n"
                         "                   [--phonemizer auto|lexicon|espeak] [--out FILE.wav] [--phonemes] [--check] [--quiet] [TEXT ...]\n");
}

// What the player thread plays, in order.
struct Queue
{
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<std::vector<int16_t>> pieces;
    bool done = false;
};

double seconds(std::chrono::steady_clock::time_point since)
{
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - since).count();
}

} // namespace

int main(int argc, char **argv)
{
    const auto started = std::chrono::steady_clock::now();
    std::string modelDir, voice = DEFAULT_VOICE, library, lexiconPath, phonemizerMode = "lexicon", outPath, text;
    float speed = 1.0f;
    bool phonemesOnly = false, checkOnly = false, quiet = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto value = [&]() -> std::string {
            if (i + 1 >= argc) {
                usage();
                std::exit(1);
            }
            return argv[++i];
        };
        if (a == "--model") modelDir = value();
        else if (a == "--voice") voice = value();
        else if (a == "--speed") speed = std::strtof(value().c_str(), nullptr);
        else if (a == "--onnxruntime") library = value();
        else if (a == "--lexicon") lexiconPath = value();
        else if (a == "--phonemizer") phonemizerMode = value();
        else if (a == "--out") outPath = value();
        else if (a == "--phonemes") phonemesOnly = true;
        else if (a == "--check") checkOnly = true;
        else if (a == "--quiet") quiet = true;
        else if (a == "-h" || a == "--help") { usage(); return 0; }
        else if (a.size() > 1 && a[0] == '-' && a[1] == '-') { usage(); return 1; }
        else text += (text.empty() ? "" : " ") + a;
    }
    if (voice.empty())
        voice = DEFAULT_VOICE;
    if (!(speed > 0.25f && speed < 4.0f))
        speed = 1.0f;
    if (phonemizerMode != "auto" && phonemizerMode != "lexicon" && phonemizerMode != "espeak") {
        usage();
        return 1;
    }

    if (modelDir.empty()) {
        const char *env = std::getenv("PHOENIX_TTS_MODEL");
        for (const std::string &d : { std::string(env ? env : ""), selfDir() + "/kitten", std::string("/usr/share/phoenix/kitten") }) {
            if (modelDir.empty() && exists(d + "/config.json"))
                modelDir = d;
        }
    }
    if (library.empty()) {
        const char *env = std::getenv("PHOENIX_ONNXRUNTIME");
        if (env && *env)
            library = env;
#ifdef __APPLE__
        else if (exists(modelDir + "/libonnxruntime.dylib"))
            library = modelDir + "/libonnxruntime.dylib";
#else
        else if (exists(modelDir + "/libonnxruntime.so.1"))
            library = modelDir + "/libonnxruntime.so.1";
#endif
    }
    if (lexiconPath.empty())
        lexiconPath = modelDir + "/cmudict.dict";

    auto fail = [&](int status, const std::string &why) {
        if (checkOnly)
            std::printf("{\"ok\":false,\"error\":%s}\n", jsonQuote(why).c_str());
        else
            std::fprintf(stderr, "phoenix-tts: %s\n", why.c_str());
        return status;
    };

    // The phonemes: the dictionary, or espeak-ng.
    std::string espeak;
    if (phonemizerMode != "lexicon")
        espeak = findProgram("espeak-ng");
    if (phonemizerMode == "espeak" && espeak.empty())
        return fail(3, "--phonemizer espeak: espeak-ng is not installed");
    Lexicon lexicon;
    std::string error;
    if (espeak.empty() && !lexicon.load(lexiconPath, &error))
        return fail(3, "the pronouncing dictionary is missing (" + error + ")");
    const Phonemizer phonemizer(&lexicon, espeak);

    if (!checkOnly && text.empty())
        text.assign(std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>());
    const std::vector<std::string> sentences = splitSentences(normalizeEnglish(text));
    if (phonemesOnly) {
        for (const std::string &s : sentences)
            std::printf("%s\n", phonemizer.phonemize(s, &error).c_str());
        return 0;
    }

    if (modelDir.empty())
        return fail(3, "the Kitten TTS model is not installed (PHOENIX_TTS_MODEL, kitten/ beside phoenix-tts or /usr/share/phoenix/kitten)");
    // The sound first: without it nothing is loaded (the caller goes on to its fallback at once).
    std::unique_ptr<Player> player;
    if (outPath.empty() && !checkOnly) {
        player = Player::open(SAMPLE_RATE, &error);
        if (!player)
            return fail(4, error);
    }
    Kitten kitten;
    if (!kitten.load(modelDir, library, &error, !checkOnly))
        return fail(3, error);
    if (!kitten.hasVoice(voice)) {
        if (!quiet && !checkOnly)
            std::fprintf(stderr, "phoenix-tts: no voice %s; %s instead\n", voice.c_str(), DEFAULT_VOICE);
        voice = DEFAULT_VOICE;
    }
    if (checkOnly) {
        std::string list;
        for (const std::string &v : kitten.voices())
            list += (list.empty() ? "" : ",") + jsonQuote(v);
        std::printf("{\"ok\":true,\"engine\":\"Kitten TTS\",\"model\":%s,\"phonemizer\":%s,\"voices\":[%s]}\n",
                    jsonQuote(modelDir).c_str(), jsonQuote(espeak.empty() ? "lexicon" : "espeak-ng").c_str(), list.c_str());
        return 0;
    }
    const double loadSeconds = seconds(started);

    // Playing (or collecting, for --out) on a thread of its own.
    Queue queue;
    std::vector<int16_t> everything;
    std::string playError;
    std::thread playing([&]() {
        for (;;) {
            std::vector<int16_t> piece;
            {
                std::unique_lock<std::mutex> lock(queue.mutex);
                queue.changed.wait(lock, [&]() { return queue.done || !queue.pieces.empty(); });
                if (queue.pieces.empty())
                    break;
                piece = std::move(queue.pieces.front());
                queue.pieces.pop_front();
            }
            if (player) {
                if (playError.empty() && !player->play(piece, &playError))
                    std::fprintf(stderr, "phoenix-tts: %s\n", playError.c_str());
            } else {
                everything.insert(everything.end(), piece.begin(), piece.end());
            }
        }
        if (player && playError.empty())
            player->drain();
    });

    double firstSound = -1, synthSeconds = 0, audioSeconds = 0;
    for (size_t k = 0; k < sentences.size(); ++k) {
        const auto t0 = std::chrono::steady_clock::now();
        const std::string phonemes = phonemizer.phonemize(sentences[k], &error);
        std::vector<long long> ids = kittenIds(phonemes);
        // Kitten reads up to 510 symbols (with its two 0s, 512).
        if (ids.size() > 500)
            ids.resize(500);
        Kitten::Audio audio;
        if (ids.empty())
            continue;
        if (!kitten.synthesize(ids, voice, speed, &audio, &error)) {
            std::fprintf(stderr, "phoenix-tts: %s\n", error.c_str());
            continue;
        }
        std::vector<float> speech = Kitten::trimmed(audio, ids);
        synthSeconds += seconds(t0);
        // A pause after it: longer at the end of a sentence than at a comma.
        const std::string &s = sentences[k];
        const char last = s.empty() ? '.' : s.back();
        const bool full = last == '.' || last == '!' || last == '?' || last == '"';
        if (k + 1 < sentences.size())
            speech.resize(speech.size() + size_t(SAMPLE_RATE * (full ? 0.28 : 0.12)), 0.0f);
        audioSeconds += double(speech.size()) / SAMPLE_RATE;
        {
            std::lock_guard<std::mutex> lock(queue.mutex);
            queue.pieces.push_back(toPcm16(speech));
        }
        queue.changed.notify_one();
        if (firstSound < 0)
            firstSound = seconds(started);
    }
    {
        std::lock_guard<std::mutex> lock(queue.mutex);
        queue.done = true;
    }
    queue.changed.notify_one();
    playing.join();

    if (!outPath.empty() && !writeWav(outPath, everything, SAMPLE_RATE, &error))
        return fail(1, error);
    if (!quiet) {
        std::fprintf(stderr, "phoenix-tts: Kitten TTS (%s), voice %s, %zu sentence%s, %.1f s of speech; first sound after %.2f s "
                             "(model loaded in %.2f s), real-time factor %.2f; %s phonemes; %s\n",
                     modelDir.c_str(), voice.c_str(), sentences.size(), sentences.size() == 1 ? "" : "s", audioSeconds,
                     firstSound < 0 ? 0.0 : firstSound, loadSeconds, audioSeconds > 0 ? synthSeconds / audioSeconds : 0.0,
                     espeak.empty() ? "dictionary" : "espeak-ng", player ? player->name().c_str() : outPath.c_str());
    }
    if (player && !playError.empty())
        return 4;
    return 0;
}
