// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Where phoenix-tts's speech goes: the computer's or the device's sound
// (PulseAudio, else ALSA, both loaded when needed, on Linux; Audio Queue
// Services on a Mac), or a WAV file.

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace phoenix::tts {

std::vector<int16_t> toPcm16(const std::vector<float> &samples);
bool writeWav(const std::string &path, const std::vector<int16_t> &pcm, int rate, std::string *error);

class Player
{
public:
    virtual ~Player() = default;
    // Queues the samples and returns; the sound plays on.
    virtual bool play(const std::vector<int16_t> &pcm, std::string *error) = 0;
    // Waits until all of it has been heard.
    virtual void drain() = 0;
    virtual std::string name() const = 0;

    // The first sound output that opens: PulseAudio (PipeWire's too), then
    // ALSA's default device; Audio Queue Services on a Mac.
    static std::unique_ptr<Player> open(int rate, std::string *error);
};

} // namespace phoenix::tts
