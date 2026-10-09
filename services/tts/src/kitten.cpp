// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "kitten.h"

#include "json.h"
#include "onnxruntime_c_api.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <iterator>

#include <dlfcn.h>

namespace phoenix::tts {

// The C API version asked of the library: 1.16 (2023) and later have every
// call used here, so an older system library still does.
constexpr uint32_t ORT_API = 16;

namespace {

uint32_t le32(const unsigned char *p) { return p[0] | p[1] << 8 | p[2] << 16 | uint32_t(p[3]) << 24; }
uint16_t le16(const unsigned char *p) { return uint16_t(p[0] | p[1] << 8); }

std::string readFile(const std::string &path)
{
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

// One .npy array of little-endian float32 values: its shape and values.
bool readNpy(const std::string &d, std::vector<size_t> *shape, std::vector<float> *values)
{
    if (d.size() < 10 || std::memcmp(d.data(), "\x93NUMPY", 6) != 0)
        return false;
    const auto *u = reinterpret_cast<const unsigned char *>(d.data());
    const int major = u[6];
    const size_t headerLen = major >= 2 ? le32(u + 8) : le16(u + 8);
    const size_t start = (major >= 2 ? 12 : 10) + headerLen;
    if (start > d.size())
        return false;
    const std::string header = d.substr(major >= 2 ? 12 : 10, headerLen);
    if (header.find("'descr': '<f4'") == std::string::npos || header.find("'fortran_order': False") == std::string::npos)
        return false;
    const size_t open = header.find('(', header.find("'shape'"));
    const size_t close = header.find(')', open);
    if (open == std::string::npos || close == std::string::npos)
        return false;
    size_t count = 1;
    shape->clear();
    for (size_t i = open + 1; i < close;) {
        while (i < close && !std::isdigit(static_cast<unsigned char>(header[i])))
            ++i;
        if (i >= close)
            break;
        size_t v = 0;
        while (i < close && std::isdigit(static_cast<unsigned char>(header[i])))
            v = v * 10 + size_t(header[i++] - '0');
        shape->push_back(v);
        count *= v;
    }
    if (shape->empty() || d.size() - start < count * 4)
        return false;
    values->resize(count);
    std::memcpy(values->data(), d.data() + start, count * 4);  // little-endian hosts (every target)
    return true;
}

} // namespace

bool readVoices(const std::string &npzPath, std::map<std::string, std::vector<std::vector<float>>> *voices,
                std::string *error)
{
    const std::string z = readFile(npzPath);
    const auto *u = reinterpret_cast<const unsigned char *>(z.data());
    voices->clear();
    // The zip's local file headers, one after the other; numpy's savez
    // stores (method 0) unless asked to compress.
    for (size_t pos = 0; pos + 30 <= z.size() && le32(u + pos) == 0x04034b50;) {
        const uint16_t method = le16(u + pos + 8);
        const uint16_t flags = le16(u + pos + 6);
        uint32_t size = le32(u + pos + 18);
        const uint16_t nameLen = le16(u + pos + 26), extraLen = le16(u + pos + 28);
        const std::string name = z.substr(pos + 30, nameLen);
        const size_t data = pos + 30 + nameLen + extraLen;
        // A ZIP64 entry keeps its sizes in the extra field.
        if (size == 0xFFFFFFFF && extraLen >= 20 && le16(u + pos + 30 + nameLen) == 1)
            size = le32(u + pos + 30 + nameLen + 4 + 8);
        if (method != 0 || (flags & 8) || data + size > z.size()) {
            if (error)
                *error = npzPath + ": " + name + " is compressed or cut short (only stored arrays are read)";
            return false;
        }
        std::vector<size_t> shape;
        std::vector<float> values;
        if (!readNpy(z.substr(data, size), &shape, &values) || shape.back() == 0) {
            if (error)
                *error = npzPath + ": " + name + " is not an array of float32";
            return false;
        }
        const size_t width = shape.back();
        std::vector<std::vector<float>> rows;
        for (size_t r = 0; r + width <= values.size(); r += width)
            rows.emplace_back(values.begin() + long(r), values.begin() + long(r + width));
        (*voices)[name.size() > 4 && name.compare(name.size() - 4, 4, ".npy") == 0 ? name.substr(0, name.size() - 4) : name] = rows;
        pos = data + size;
    }
    if (voices->empty() && error)
        *error = npzPath + " has no voices";
    return !voices->empty();
}

Kitten::~Kitten()
{
    if (m_api) {
        if (m_memory)
            m_api->ReleaseMemoryInfo(m_memory);
        if (m_session)
            m_api->ReleaseSession(m_session);
        if (m_env)
            m_api->ReleaseEnv(m_env);
    }
    // The library stays loaded: its threads may outlive the session.
}

bool Kitten::check(void *status, std::string *error)
{
    if (!status)
        return true;
    auto *s = static_cast<OrtStatus *>(status);
    if (error)
        *error = std::string("ONNX Runtime: ") + m_api->GetErrorMessage(s);
    m_api->ReleaseStatus(s);
    return false;
}

bool Kitten::load(const std::string &dir, const std::string &library, std::string *error, bool session)
{
    bool ok = false;
    const Json config = Json::parse(readFile(dir + "/config.json"), &ok);
    if (!ok || !config.isObject()) {
        if (error)
            *error = dir + "/config.json is missing or not JSON";
        return false;
    }
    const std::string type = config["type"].str();
    if (type != "ONNX1" && type != "ONNX2") {
        if (error)
            *error = dir + ": not a Kitten ONNX model (type " + type + ")";
        return false;
    }
    if (!readVoices(dir + "/" + config["voices"].str("voices.npz"), &m_voices, error))
        return false;
    for (const auto &m : config["speed_priors"].members())
        m_speedPriors[m.first] = float(m.second.num(1));
    for (const auto &m : config["voice_aliases"].members())
        m_aliases[m.first] = m.second.str();

    std::vector<std::string> names;
    if (!library.empty()) {
        names.push_back(library);
    } else {
#ifdef __APPLE__
        names = { "libonnxruntime.dylib", "/opt/homebrew/lib/libonnxruntime.dylib", "/usr/local/lib/libonnxruntime.dylib" };
#else
        names = { "libonnxruntime.so.1", "libonnxruntime.so" };
#endif
    }
    std::string why;
    for (const std::string &n : names) {
        m_lib = dlopen(n.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (m_lib)
            break;
        const char *e = dlerror();
        why = e ? e : n;
    }
    if (!m_lib) {
        if (error)
            *error = "ONNX Runtime is not installed (" + why + ")";
        return false;
    }
    using GetApiBase = const OrtApiBase *(*)();
    auto base = reinterpret_cast<GetApiBase>(dlsym(m_lib, "OrtGetApiBase"));
    m_api = base ? base()->GetApi(ORT_API) : nullptr;
    if (!m_api) {
        if (error)
            *error = "the ONNX Runtime library is older than 1.16";
        return false;
    }
    const std::string model = dir + "/" + config["model_file"].str();
    if (!session) {
        std::ifstream f(model);
        if (!f && error)
            *error = model + " is missing";
        return bool(f);
    }
    if (!check(m_api->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "phoenix-tts", &m_env), error))
        return false;
    OrtSessionOptions *options = nullptr;
    if (!check(m_api->CreateSessionOptions(&options), error))
        return false;
    // One thread and no graph rewriting: the fastest here (measured with
    // the nano model: more threads do not help a model this small, and the
    // optimizations cost more to load than they save; docs/AI-AND-MCP.md).
    bool good = check(m_api->SetIntraOpNumThreads(options, 1), error)
        && check(m_api->SetInterOpNumThreads(options, 1), error)
        && check(m_api->SetSessionGraphOptimizationLevel(options, ORT_DISABLE_ALL), error);
    good = good && check(m_api->CreateSession(m_env, model.c_str(), options, &m_session), error);
    m_api->ReleaseSessionOptions(options);
    good = good && check(m_api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &m_memory), error);
    return good;
}

std::vector<std::string> Kitten::voices() const
{
    std::vector<std::string> v;
    for (const auto &p : m_voices)
        v.push_back(p.first);
    return v;
}

bool Kitten::hasVoice(const std::string &voice) const
{
    const auto a = m_aliases.find(voice);
    return m_voices.count(a == m_aliases.end() ? voice : a->second) > 0;
}

bool Kitten::synthesize(const std::vector<long long> &symbols, const std::string &requested, float speed, Audio *out,
                        std::string *error)
{
    if (!m_session) {
        if (error)
            *error = "no model";
        return false;
    }
    const auto alias = m_aliases.find(requested);
    const std::string voice = alias == m_aliases.end() ? requested : alias->second;
    const auto v = m_voices.find(voice);
    if (v == m_voices.end() || v->second.empty()) {
        if (error)
            *error = "no voice " + requested;
        return false;
    }
    const auto prior = m_speedPriors.find(voice);
    if (prior != m_speedPriors.end())
        speed *= prior->second;
    std::vector<long long> ids;
    ids.reserve(symbols.size() + 2);
    ids.push_back(0);
    ids.insert(ids.end(), symbols.begin(), symbols.end());
    ids.push_back(0);
    // A voice with a row per text length (Kitten 0.8) takes the row for this
    // length, as KittenML's code does; 0.2's voices have one.
    std::vector<float> style = v->second[std::min(symbols.size(), v->second.size() - 1)];
    float speedValue = speed;

    const int64_t idsShape[2] = { 1, int64_t(ids.size()) };
    const int64_t styleShape[2] = { 1, int64_t(style.size()) };
    const int64_t speedShape[1] = { 1 };
    OrtValue *inputs[3] = { nullptr, nullptr, nullptr };
    OrtValue *outputs[2] = { nullptr, nullptr };
    bool good = check(m_api->CreateTensorWithDataAsOrtValue(m_memory, ids.data(), ids.size() * sizeof(long long), idsShape, 2,
                                                            ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &inputs[0]), error)
        && check(m_api->CreateTensorWithDataAsOrtValue(m_memory, style.data(), style.size() * sizeof(float), styleShape, 2,
                                                       ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &inputs[1]), error)
        && check(m_api->CreateTensorWithDataAsOrtValue(m_memory, &speedValue, sizeof(float), speedShape, 1,
                                                       ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &inputs[2]), error);
    const char *inNames[3] = { "input_ids", "style", "speed" };
    const char *outNames[2] = { "waveform", "duration" };
    good = good && check(m_api->Run(m_session, nullptr, inNames, inputs, 3, outNames, 2, outputs), error);
    auto elements = [&](OrtValue *value, size_t *count) {
        OrtTensorTypeAndShapeInfo *info = nullptr;
        bool k = check(m_api->GetTensorTypeAndShape(value, &info), error);
        k = k && check(m_api->GetTensorShapeElementCount(info, count), error);
        if (info)
            m_api->ReleaseTensorTypeAndShapeInfo(info);
        return k;
    };
    if (good) {
        size_t n = 0, m = 0;
        float *wave = nullptr;
        int64_t *dur = nullptr;
        good = elements(outputs[0], &n) && elements(outputs[1], &m)
            && check(m_api->GetTensorMutableData(outputs[0], reinterpret_cast<void **>(&wave)), error)
            && check(m_api->GetTensorMutableData(outputs[1], reinterpret_cast<void **>(&dur)), error);
        if (good) {
            out->samples.assign(wave, wave + n);
            out->frames.assign(dur, dur + m);
        }
    }
    for (OrtValue *value : inputs)
        if (value)
            m_api->ReleaseValue(value);
    for (OrtValue *value : outputs)
        if (value)
            m_api->ReleaseValue(value);
    return good;
}

std::vector<float> Kitten::trimmed(const Audio &audio, const std::vector<long long> &ids)
{
    const std::vector<float> &s = audio.samples;
    if (audio.frames.size() != ids.size() + 2)
        return s;
    // Symbols 1-16 are punctuation and the space; from 17 on, letters and IPA.
    size_t lastSound = 0;
    for (size_t i = 0; i < ids.size(); ++i)
        if (ids[i] >= 17)
            lastSound = i + 1;  // its index among frames (after the leading 0)
    if (!lastSound)
        return {};
    long long before = 0;
    for (size_t i = 0; i <= lastSound; ++i)
        before += audio.frames[i];
    // A little of the mark after the last word (its release), 100 ms at most.
    const long long markFrames = lastSound + 1 < audio.frames.size() ? audio.frames[lastSound + 1] : 0;
    const long long tail = std::min<long long>(markFrames, 4);
    const size_t start = size_t(std::max<long long>(0, audio.frames[0] * HOP - SAMPLE_RATE / 50));
    const size_t end = std::min(s.size(), size_t((before + tail) * HOP));
    if (start >= end)
        return {};
    std::vector<float> out(s.begin() + long(start), s.begin() + long(end));
    const size_t fadeIn = std::min<size_t>(out.size(), SAMPLE_RATE / 200);
    const size_t fadeOut = std::min<size_t>(out.size(), SAMPLE_RATE / 40);
    for (size_t i = 0; i < fadeIn; ++i)
        out[i] *= float(i) / float(fadeIn);
    for (size_t i = 0; i < fadeOut; ++i)
        out[out.size() - 1 - i] *= float(i) / float(fadeOut);
    return out;
}

} // namespace phoenix::tts
