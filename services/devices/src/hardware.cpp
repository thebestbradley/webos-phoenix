// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "hardware.h"

#include "devicecore.h"
#include "json.h"

#include <dirent.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

namespace phoenix {
namespace devices {

// ---- Files -----------------------------------------------------------------------

static bool exists(const std::string &path) { return ::access(path.c_str(), F_OK) == 0; }

static std::string readText(const std::string &path)
{
    std::ifstream f(path);
    if (!f)
        return std::string();
    std::stringstream s;
    s << f.rdbuf();
    std::string out = s.str();
    while (!out.empty() && (out.back() == '\n' || out.back() == ' '))
        out.pop_back();
    return out;
}

static bool writeText(const std::string &path, const std::string &text)
{
    // O_TRUNC: sysfs ignores it; a plain file (the tests' fake sysfs) needs it.
    const int fd = ::open(path.c_str(), O_WRONLY | O_TRUNC | O_CLOEXEC);
    if (fd < 0)
        return false;
    const bool ok = ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size());
    ::close(fd);
    return ok;
}

static std::vector<std::string> entries(const std::string &dir, const std::string &prefix)
{
    std::vector<std::string> out;
    if (DIR *d = ::opendir(dir.c_str())) {
        while (struct dirent *e = ::readdir(d)) {
            const std::string name = e->d_name;
            if (name != "." && name != ".." && name.compare(0, prefix.size(), prefix) == 0)
                out.push_back(name);
        }
        ::closedir(d);
    }
    std::sort(out.begin(), out.end());
    return out;
}

// ---- device.json -------------------------------------------------------------------

DeviceConfig DeviceConfig::load(const std::string &path)
{
    DeviceConfig c;
    const Json j = Json::parse(readText(path));
    if (!j.isObject())
        return c;
    c.backlight = j["backlight"].str();
    c.lightSensor = j["lightSensor"].str();
    // "ringerSwitch": {"type": "EV_SW" | "EV_KEY", "code": n, "silentValue": 1}
    const Json &r = j["ringerSwitch"];
    if (r.isObject() && r["code"].isNumber()) {
        c.ringerType = r["type"].str("EV_SW") == "EV_KEY" ? EV_KEY : EV_SW;
        c.ringerCode = static_cast<int>(r["code"].num());
        c.ringerSilentValue = static_cast<int>(r["silentValue"].num(1));
    }
    return c;
}

// ---- Backlight -------------------------------------------------------------------------

Backlight::Backlight(const std::string &root, const std::string &name)
{
    const std::string base = root + "/sys/class/backlight/";
    std::vector<std::string> names = name.empty() ? entries(base, "") : std::vector<std::string>{ name };
    for (const auto &n : names) {
        const std::string dir = base + n;
        const int max = std::atoi(readText(dir + "/max_brightness").c_str());
        if (max > 0) {
            m_dir = dir;
            m_max = max;
            break;
        }
    }
}

bool Backlight::setPercent(int percent)
{
    if (m_dir.empty())
        return false;
    const int power = percent > 0 ? 0 : 4;   // FB_BLANK_UNBLANK / FB_BLANK_POWERDOWN
    if (power != m_lastPower && exists(m_dir + "/bl_power")) {
        // Up before the level, down after it.
        if (power == 0)
            writeText(m_dir + "/bl_power", "0");
    }
    const bool ok = writeText(m_dir + "/brightness", std::to_string(backlightRaw(percent, m_max)));
    if (power != m_lastPower && power == 4 && exists(m_dir + "/bl_power"))
        writeText(m_dir + "/bl_power", "4");
    m_lastPower = power;
    return ok;
}

// ---- Vibrator ------------------------------------------------------------------------------

static bool testBit(const unsigned long *bits, int bit)
{
    const int perLong = static_cast<int>(sizeof(unsigned long) * 8);
    return (bits[bit / perLong] >> (bit % perLong)) & 1UL;
}

Vibrator::Vibrator(const std::string &root)
{
    const std::string input = root + "/dev/input/";
    for (const auto &n : entries(input, "event")) {
        const int fd = ::open((input + n).c_str(), O_RDWR | O_CLOEXEC);
        if (fd < 0)
            continue;
        unsigned long ff[(FF_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
        if (::ioctl(fd, EVIOCGBIT(EV_FF, sizeof ff), ff) >= 0 && testBit(ff, FF_RUMBLE)) {
            m_kind = ForceFeedback;
            m_path = input + n;
            m_fd = fd;
            return;
        }
        ::close(fd);
    }
    const std::string led = root + "/sys/class/leds/vibrator";
    if (exists(led + "/trigger")) {
        // The transient trigger adds activate, duration and state.
        writeText(led + "/trigger", "transient");
        if (exists(led + "/activate")) {
            m_kind = LedTransient;
            m_path = led;
            return;
        }
    }
    const std::string timed = root + "/sys/class/timed_output/vibrator";
    if (exists(timed + "/enable")) {
        m_kind = TimedOutput;
        m_path = timed;
    }
}

Vibrator::~Vibrator()
{
    stop();
    if (m_fd >= 0) {
        if (m_effect >= 0)
            ::ioctl(m_fd, EVIOCRMFF, m_effect);
        ::close(m_fd);
    }
}

// Long enough for "until stopped" where the driver needs a length.
static const int Endless = 60000;

bool Vibrator::run(int ms)
{
    const int length = ms > 0 ? ms : Endless;
    switch (m_kind) {
    case ForceFeedback: {
        struct ff_effect effect;
        std::memset(&effect, 0, sizeof effect);
        effect.type = FF_RUMBLE;
        effect.id = static_cast<__s16>(m_effect);
        effect.u.rumble.strong_magnitude = 0xFFFF;
        effect.replay.length = static_cast<__u16>(std::min(length, 0xFFFF));
        if (::ioctl(m_fd, EVIOCSFF, &effect) < 0)
            return false;
        m_effect = effect.id;
        struct input_event play;
        std::memset(&play, 0, sizeof play);
        play.type = EV_FF;
        play.code = static_cast<__u16>(m_effect);
        play.value = 1;
        return ::write(m_fd, &play, sizeof play) == static_cast<ssize_t>(sizeof play);
    }
    case LedTransient:
        return writeText(m_path + "/duration", std::to_string(length)) && writeText(m_path + "/state", "1")
            && writeText(m_path + "/activate", "1");
    case TimedOutput:
        return writeText(m_path + "/enable", std::to_string(length));
    case None:
        break;
    }
    return false;
}

void Vibrator::stop()
{
    switch (m_kind) {
    case ForceFeedback:
        if (m_effect >= 0) {
            struct input_event stopEv;
            std::memset(&stopEv, 0, sizeof stopEv);
            stopEv.type = EV_FF;
            stopEv.code = static_cast<__u16>(m_effect);
            stopEv.value = 0;
            if (::write(m_fd, &stopEv, sizeof stopEv) < 0) { /* the device went */ }
        }
        break;
    case LedTransient:
        writeText(m_path + "/activate", "0");
        break;
    case TimedOutput:
        writeText(m_path + "/enable", "0");
        break;
    case None:
        break;
    }
}

// ---- Light sensor -------------------------------------------------------------------------

LightSensor::LightSensor(const std::string &root, const std::string &name)
{
    const std::string base = root + "/sys/bus/iio/devices/";
    std::vector<std::string> names = name.empty() ? entries(base, "iio:device") : std::vector<std::string>{ name };
    for (const auto &n : names) {
        const std::string dir = base + n + "/";
        for (const char *ch : { "in_illuminance_", "in_illuminance0_" }) {
            if (exists(dir + ch + "input")) {
                m_input = dir + ch + "input";
                return;
            }
            if (exists(dir + ch + "raw")) {
                m_raw = dir + ch + "raw";
                const std::string scale = readText(dir + ch + "scale");
                const std::string offset = readText(dir + ch + "offset");
                if (!scale.empty())
                    m_scale = std::atof(scale.c_str());
                if (!offset.empty())
                    m_offset = std::atof(offset.c_str());
                return;
            }
        }
    }
}

int LightSensor::read() const
{
    if (!m_input.empty()) {
        const std::string v = readText(m_input);
        return v.empty() ? -1 : static_cast<int>(std::atof(v.c_str()) + 0.5);
    }
    if (!m_raw.empty()) {
        const std::string v = readText(m_raw);
        return v.empty() ? -1 : static_cast<int>((std::atof(v.c_str()) + m_offset) * m_scale + 0.5);
    }
    return -1;
}

// ---- Input devices ---------------------------------------------------------------------------

std::vector<InputDevices::Event> decodeInputEvents(const struct input_event *ev, size_t count)
{
    std::vector<InputDevices::Event> out;
    for (size_t i = 0; i < count; ++i) {
        if (ev[i].type == EV_SW || (ev[i].type == EV_KEY && ev[i].value != 2))
            out.push_back({ ev[i].type, ev[i].code, ev[i].value });
    }
    return out;
}

InputDevices::InputDevices(const std::string &root, const DeviceConfig &config)
{
    const std::string input = root + "/dev/input/";
    const int keyCodes[] = { KEY_VOLUMEUP, KEY_VOLUMEDOWN, KEY_POWER, KEY_PLAYCD, KEY_PAUSECD, KEY_PLAYPAUSE,
                             KEY_STOPCD, KEY_NEXTSONG, KEY_PREVIOUSSONG, KEY_MEDIA };
    for (const auto &n : entries(input, "event")) {
        const int fd = ::open((input + n).c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
        if (fd < 0)
            continue;
        unsigned long sw[(SW_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
        unsigned long keys[(KEY_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
        const bool hasSw = ::ioctl(fd, EVIOCGBIT(EV_SW, sizeof sw), sw) >= 0;
        const bool hasKeys = ::ioctl(fd, EVIOCGBIT(EV_KEY, sizeof keys), keys) >= 0;
        bool wanted = false;
        if (hasSw)
            wanted = testBit(sw, SW_HEADPHONE_INSERT) || testBit(sw, SW_MICROPHONE_INSERT)
                || (config.ringerType == EV_SW && config.ringerCode >= 0 && config.ringerCode <= SW_MAX
                    && testBit(sw, config.ringerCode));
        if (!wanted && hasKeys) {
            for (int code : keyCodes)
                wanted = wanted || testBit(keys, code);
            if (config.ringerType == EV_KEY && config.ringerCode >= 0 && config.ringerCode <= KEY_MAX)
                wanted = wanted || testBit(keys, config.ringerCode);
        }
        if (wanted) {
            m_fds.push_back(fd);
            m_paths.push_back(input + n);
        } else {
            ::close(fd);
        }
    }
}

InputDevices::~InputDevices()
{
    for (int fd : m_fds)
        ::close(fd);
}

std::vector<InputDevices::Event> InputDevices::readFrom(int fd)
{
    struct input_event ev[64];
    std::vector<Event> out;
    for (;;) {
        const ssize_t n = ::read(fd, ev, sizeof ev);
        if (n <= 0)
            break;
        auto more = decodeInputEvents(ev, static_cast<size_t>(n) / sizeof ev[0]);
        out.insert(out.end(), more.begin(), more.end());
    }
    return out;
}

int InputDevices::switchState(int type, int code) const
{
    for (int fd : m_fds) {
        if (type == EV_SW) {
            unsigned long sw[(SW_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
            unsigned long has[(SW_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
            if (code > SW_MAX || ::ioctl(fd, EVIOCGBIT(EV_SW, sizeof has), has) < 0 || !testBit(has, code))
                continue;
            if (::ioctl(fd, EVIOCGSW(sizeof sw), sw) >= 0)
                return testBit(sw, code) ? 1 : 0;
        } else if (type == EV_KEY) {
            unsigned long keys[(KEY_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
            unsigned long has[(KEY_MAX + 1) / (sizeof(unsigned long) * 8) + 1] = {};
            if (code > KEY_MAX || ::ioctl(fd, EVIOCGBIT(EV_KEY, sizeof has), has) < 0 || !testBit(has, code))
                continue;
            if (::ioctl(fd, EVIOCGKEY(sizeof keys), keys) >= 0)
                return testBit(keys, code) ? 1 : 0;
        }
    }
    return -1;
}

} // namespace devices
} // namespace phoenix
