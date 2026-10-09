// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "audio.h"

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <fstream>

#ifdef __APPLE__
#include <AudioToolbox/AudioToolbox.h>
#include <unistd.h>
#else
#include <dlfcn.h>
#endif

namespace phoenix::tts {

std::vector<int16_t> toPcm16(const std::vector<float> &samples)
{
    std::vector<int16_t> pcm(samples.size());
    for (size_t i = 0; i < samples.size(); ++i)
        pcm[i] = int16_t(std::lround(std::clamp(samples[i], -1.0f, 1.0f) * 32767.0f));
    return pcm;
}

namespace {
void put32(std::ofstream &o, uint32_t v) { const char b[4] = { char(v), char(v >> 8), char(v >> 16), char(v >> 24) }; o.write(b, 4); }
void put16(std::ofstream &o, uint16_t v) { const char b[2] = { char(v), char(v >> 8) }; o.write(b, 2); }
} // namespace

bool writeWav(const std::string &path, const std::vector<int16_t> &pcm, int rate, std::string *error)
{
    std::ofstream o(path, std::ios::binary | std::ios::trunc);
    if (!o) {
        if (error)
            *error = "cannot write " + path;
        return false;
    }
    const uint32_t bytes = uint32_t(pcm.size() * 2);
    o.write("RIFF", 4);
    put32(o, 36 + bytes);
    o.write("WAVEfmt ", 8);
    put32(o, 16);
    put16(o, 1);   // PCM
    put16(o, 1);   // mono
    put32(o, uint32_t(rate));
    put32(o, uint32_t(rate) * 2);
    put16(o, 2);
    put16(o, 16);
    o.write("data", 4);
    put32(o, bytes);
    for (int16_t s : pcm)
        put16(o, uint16_t(s));
    return bool(o);
}

#ifdef __APPLE__

// Audio Queue Services: each piece in a buffer of its own, freed when played.
class QueuePlayer : public Player
{
public:
    ~QueuePlayer() override
    {
        if (m_queue)
            AudioQueueDispose(m_queue, true);
    }
    bool start(int rate, std::string *error)
    {
        AudioStreamBasicDescription f = {};
        f.mSampleRate = rate;
        f.mFormatID = kAudioFormatLinearPCM;
        f.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
        f.mBytesPerPacket = 2;
        f.mFramesPerPacket = 1;
        f.mBytesPerFrame = 2;
        f.mChannelsPerFrame = 1;
        f.mBitsPerChannel = 16;
        // No run loop: the callback runs on the queue's own thread.
        const OSStatus s = AudioQueueNewOutput(&f, &QueuePlayer::done, this, nullptr, nullptr, 0, &m_queue);
        if (s != noErr) {
            if (error)
                *error = "Audio Queue Services: error " + std::to_string(int(s));
            m_queue = nullptr;
            return false;
        }
        return true;
    }
    bool play(const std::vector<int16_t> &pcm, std::string *error) override
    {
        if (pcm.empty())
            return true;
        AudioQueueBufferRef buffer = nullptr;
        const UInt32 bytes = UInt32(pcm.size() * 2);
        OSStatus s = AudioQueueAllocateBuffer(m_queue, bytes, &buffer);
        if (s == noErr) {
            std::memcpy(buffer->mAudioData, pcm.data(), bytes);
            buffer->mAudioDataByteSize = bytes;
            ++m_pending;
            s = AudioQueueEnqueueBuffer(m_queue, buffer, 0, nullptr);
            if (s != noErr)
                --m_pending;
        }
        if (s == noErr && !m_started) {
            s = AudioQueueStart(m_queue, nullptr);
            m_started = s == noErr;
        }
        if (s != noErr && error)
            *error = "Audio Queue Services: error " + std::to_string(int(s));
        return s == noErr;
    }
    void drain() override
    {
        if (!m_started)
            return;
        // Until every buffer has been played, then the queue stops after them.
        while (m_pending > 0)
            usleep(10000);
        AudioQueueStop(m_queue, false);
        for (int i = 0; i < 100; ++i) {
            UInt32 running = 0, size = sizeof running;
            if (AudioQueueGetProperty(m_queue, kAudioQueueProperty_IsRunning, &running, &size) != noErr || !running)
                break;
            usleep(10000);
        }
    }
    std::string name() const override { return "Audio Queue Services"; }

private:
    static void done(void *self, AudioQueueRef queue, AudioQueueBufferRef buffer)
    {
        AudioQueueFreeBuffer(queue, buffer);
        --static_cast<QueuePlayer *>(self)->m_pending;
    }
    AudioQueueRef m_queue = nullptr;
    std::atomic<int> m_pending { 0 };
    bool m_started = false;
};

std::unique_ptr<Player> Player::open(int rate, std::string *error)
{
    auto p = std::make_unique<QueuePlayer>();
    if (!p->start(rate, error))
        return nullptr;
    return p;
}

#else

// PulseAudio's simple API (PipeWire answers it too), from libpulse-simple.
class PulsePlayer : public Player
{
public:
    struct SampleSpec { int format; uint32_t rate; uint8_t channels; };
    using New = void *(*)(const char *, const char *, int, const char *, const char *, const SampleSpec *, const void *,
                          const void *, int *);
    using Write = int (*)(void *, const void *, size_t, int *);
    using Drain = int (*)(void *, int *);
    using Free = void (*)(void *);
    using StrError = const char *(*)(int);

    ~PulsePlayer() override
    {
        if (m_stream)
            m_free(m_stream);
    }
    bool start(int rate, std::string *error)
    {
        m_lib = dlopen("libpulse-simple.so.0", RTLD_NOW | RTLD_LOCAL);
        if (!m_lib) {
            *error = "no PulseAudio (libpulse-simple)";
            return false;
        }
        auto open = reinterpret_cast<New>(dlsym(m_lib, "pa_simple_new"));
        m_write = reinterpret_cast<Write>(dlsym(m_lib, "pa_simple_write"));
        m_drain = reinterpret_cast<Drain>(dlsym(m_lib, "pa_simple_drain"));
        m_free = reinterpret_cast<Free>(dlsym(m_lib, "pa_simple_free"));
        m_strerror = reinterpret_cast<StrError>(dlsym(m_lib, "pa_strerror"));
        if (!open || !m_write || !m_drain || !m_free) {
            *error = "libpulse-simple lacks its calls";
            return false;
        }
        const SampleSpec spec = { 3 /* PA_SAMPLE_S16LE */, uint32_t(rate), 1 };
        int e = 0;
        m_stream = open(nullptr, "Phoenix", 1 /* PA_STREAM_PLAYBACK */, nullptr, "Assistant speech", &spec, nullptr, nullptr, &e);
        if (!m_stream) {
            *error = std::string("PulseAudio: ") + (m_strerror ? m_strerror(e) : std::to_string(e).c_str());
            return false;
        }
        return true;
    }
    bool play(const std::vector<int16_t> &pcm, std::string *error) override
    {
        int e = 0;
        if (m_write(m_stream, pcm.data(), pcm.size() * 2, &e) < 0) {
            *error = std::string("PulseAudio: ") + (m_strerror ? m_strerror(e) : "write failed");
            return false;
        }
        return true;
    }
    void drain() override
    {
        int e = 0;
        m_drain(m_stream, &e);
    }
    std::string name() const override { return "PulseAudio"; }

private:
    void *m_lib = nullptr;
    void *m_stream = nullptr;
    Write m_write = nullptr;
    Drain m_drain = nullptr;
    Free m_free = nullptr;
    StrError m_strerror = nullptr;
};

// ALSA's default device, from libasound.
class AlsaPlayer : public Player
{
public:
    using Open = int (*)(void **, const char *, int, int);
    using SetParams = int (*)(void *, int, int, unsigned, unsigned, int, unsigned);
    using WriteI = long (*)(void *, const void *, unsigned long);
    using Recover = int (*)(void *, int, int);
    using Simple = int (*)(void *);
    using StrError = const char *(*)(int);

    ~AlsaPlayer() override
    {
        if (m_pcm)
            m_close(m_pcm);
    }
    bool start(int rate, std::string *error)
    {
        m_lib = dlopen("libasound.so.2", RTLD_NOW | RTLD_LOCAL);
        if (!m_lib) {
            *error = "no ALSA (libasound)";
            return false;
        }
        auto open = reinterpret_cast<Open>(dlsym(m_lib, "snd_pcm_open"));
        // ALSA's own messages about missing cards: the error below says it.
        using Handler = void (*)(const char *, int, const char *, int, const char *, ...);
        if (auto setHandler = reinterpret_cast<int (*)(Handler)>(dlsym(m_lib, "snd_lib_error_set_handler")))
            setHandler(&AlsaPlayer::quiet);
        auto setParams = reinterpret_cast<SetParams>(dlsym(m_lib, "snd_pcm_set_params"));
        m_writei = reinterpret_cast<WriteI>(dlsym(m_lib, "snd_pcm_writei"));
        m_recover = reinterpret_cast<Recover>(dlsym(m_lib, "snd_pcm_recover"));
        m_drain = reinterpret_cast<Simple>(dlsym(m_lib, "snd_pcm_drain"));
        m_close = reinterpret_cast<Simple>(dlsym(m_lib, "snd_pcm_close"));
        m_strerror = reinterpret_cast<StrError>(dlsym(m_lib, "snd_strerror"));
        if (!open || !setParams || !m_writei || !m_recover || !m_drain || !m_close) {
            *error = "libasound lacks its calls";
            return false;
        }
        int e = open(&m_pcm, "default", 0 /* SND_PCM_STREAM_PLAYBACK */, 0);
        if (e < 0) {
            m_pcm = nullptr;
            *error = std::string("ALSA: ") + (m_strerror ? m_strerror(e) : "cannot open the default device");
            return false;
        }
        // S16_LE (2), interleaved read/write access (3), 1 channel, resampled
        // if need be, 100 ms of latency.
        e = setParams(m_pcm, 2, 3, 1, unsigned(rate), 1, 100000);
        if (e < 0) {
            *error = std::string("ALSA: ") + (m_strerror ? m_strerror(e) : "cannot set the format");
            return false;
        }
        return true;
    }
    bool play(const std::vector<int16_t> &pcm, std::string *error) override
    {
        for (size_t done = 0; done < pcm.size();) {
            long k = m_writei(m_pcm, pcm.data() + done, pcm.size() - done);
            if (k < 0)
                k = m_recover(m_pcm, int(k), 1);
            if (k < 0) {
                *error = std::string("ALSA: ") + (m_strerror ? m_strerror(int(k)) : "write failed");
                return false;
            }
            done += size_t(k);
        }
        return true;
    }
    void drain() override { m_drain(m_pcm); }
    std::string name() const override { return "ALSA"; }

private:
    static void quiet(const char *, int, const char *, int, const char *, ...) {}
    void *m_lib = nullptr;
    void *m_pcm = nullptr;
    WriteI m_writei = nullptr;
    Recover m_recover = nullptr;
    Simple m_drain = nullptr;
    Simple m_close = nullptr;
    StrError m_strerror = nullptr;
};

std::unique_ptr<Player> Player::open(int rate, std::string *error)
{
    std::string pulseWhy, alsaWhy;
    auto pulse = std::make_unique<PulsePlayer>();
    if (pulse->start(rate, &pulseWhy))
        return pulse;
    auto alsa = std::make_unique<AlsaPlayer>();
    if (alsa->start(rate, &alsaWhy))
        return alsa;
    if (error)
        *error = "no sound output: " + pulseWhy + "; " + alsaWhy;
    return nullptr;
}

#endif

} // namespace phoenix::tts
