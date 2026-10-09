// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kitten TTS (KittenML, Apache-2.0: the code and the nano 0.2 model's
// weights and voices) on ONNX Runtime (Microsoft, MIT), the Assistant's
// voice (docs/AI-AND-MCP.md, Speech). The model reads Kitten's symbol
// numbers (phonemes.h kittenIds), a voice's 256 style values and a speed,
// and gives 24 kHz audio and how many 25 ms frames each symbol lasts.
//
// ONNX Runtime is loaded when the model is (dlopen, its C API), as the wake
// word loads libvosk: phoenix-tts builds without it, and says what is
// missing where it is not installed.

#pragma once

#include <map>
#include <string>
#include <vector>

struct OrtApi;
struct OrtEnv;
struct OrtSession;
struct OrtMemoryInfo;

namespace phoenix::tts {

constexpr int SAMPLE_RATE = 24000;
constexpr int HOP = 600;  // samples a duration frame stands for

// The voices in a voices.npz (numpy's arrays in an uncompressed zip, as
// KittenML ships them): name -> rows of 256 style values.
bool readVoices(const std::string &npzPath, std::map<std::string, std::vector<std::vector<float>>> *voices,
                std::string *error);

class Kitten
{
public:
    Kitten() = default;
    ~Kitten();
    Kitten(const Kitten &) = delete;
    Kitten &operator=(const Kitten &) = delete;

    // dir: the model's folder (config.json, the .onnx file, voices.npz);
    // library: libonnxruntime's path, or "" to look for it by its name.
    // session false: only whether it could (the files, the library), fast.
    bool load(const std::string &dir, const std::string &library, std::string *error, bool session = true);

    // Voice names (expr-voice-3-f ...; the model's own names).
    std::vector<std::string> voices() const;
    bool hasVoice(const std::string &voice) const;

    struct Audio
    {
        std::vector<float> samples;      // 24 kHz mono, -1..1
        std::vector<long long> frames;   // per input symbol (the 0s at both ends included)
    };
    // ids: Kitten's symbols without the 0 at each end (they are added).
    bool synthesize(const std::vector<long long> &ids, const std::string &voice, float speed, Audio *out,
                    std::string *error);

    // The speech alone: the silence before it and the sound after its last
    // word left out (the model ends with a breath and noise after the final
    // mark), with a short fade. ids as given to synthesize.
    static std::vector<float> trimmed(const Audio &audio, const std::vector<long long> &ids);

private:
    bool check(void *status, std::string *error);

    void *m_lib = nullptr;
    const OrtApi *m_api = nullptr;
    OrtEnv *m_env = nullptr;
    OrtSession *m_session = nullptr;
    OrtMemoryInfo *m_memory = nullptr;
    std::map<std::string, std::vector<std::vector<float>>> m_voices;
    std::map<std::string, float> m_speedPriors;
    std::map<std::string, std::string> m_aliases;
};

} // namespace phoenix::tts
