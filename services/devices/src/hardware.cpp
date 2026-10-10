// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "hardware.h"

#include "devicecore.h"
#include "json.h"

#include <dirent.h>
#include <fcntl.h>
#include <linux/netlink.h>
#include <sys/inotify.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
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

// "event10" after "event9".
static bool nodeLess(const std::string &a, const std::string &b)
{
    if (a.size() != b.size())
        return a.size() < b.size();
    return a < b;
}

// ---- device.json -------------------------------------------------------------------

DeviceConfig DeviceConfig::load(const std::string &path)
{
    DeviceConfig c;
    const Json j = Json::parse(readText(path));
    if (!j.isObject())
        return c;
    c.loaded = true;
    c.backlight = j["backlight"].str();
    c.lightSensor = j["lightSensor"].str();
    c.accelerometer = j["accelerometer"].str();
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
    // The kernel's advice for which to use when there are several.
    auto rank = [&](const std::string &n) {
        const std::string type = readText(base + n + "/type");
        return type == "firmware" ? 0 : type == "platform" ? 1 : type == "raw" ? 2 : 3;
    };
    std::stable_sort(names.begin(), names.end(), [&](const std::string &a, const std::string &b) { return rank(a) < rank(b); });
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

// ---- Bitmaps ---------------------------------------------------------------------------

static const int LongBits = static_cast<int>(sizeof(unsigned long) * 8);

bool testBit(const Bits &bits, int bit)
{
    if (bit < 0 || static_cast<size_t>(bit / LongBits) >= bits.size())
        return false;
    return (bits[bit / LongBits] >> (bit % LongBits)) & 1UL;
}

Bits parseBitmap(const std::string &text)
{
    std::vector<std::string> words;
    std::stringstream s(text);
    for (std::string w; s >> w;)
        words.push_back(w);
    Bits out;
    for (auto it = words.rbegin(); it != words.rend(); ++it)
        out.push_back(std::strtoul(it->c_str(), nullptr, 16));
    return out;
}

std::string formatBitmap(const Bits &bits)
{
    size_t top = bits.size();
    while (top > 1 && bits[top - 1] == 0)
        --top;
    std::string out;
    char buf[32];
    for (size_t i = top; i-- > 0;) {
        std::snprintf(buf, sizeof buf, "%lx", bits.empty() ? 0UL : bits[i]);
        out += buf;
        if (i > 0)
            out += ' ';
    }
    return out.empty() ? "0" : out;
}

static Bits ioctlBits(int fd, int type, int max)
{
    Bits bits(static_cast<size_t>(max / LongBits + 1), 0);
    if (::ioctl(fd, EVIOCGBIT(type, bits.size() * sizeof(unsigned long)), bits.data()) < 0)
        return Bits();
    return bits;
}

// ---- Vibrator ------------------------------------------------------------------------------

const char *Vibrator::kindName(Kind k)
{
    switch (k) {
    case ForceFeedback: return "force feedback (EV_FF, FF_RUMBLE)";
    case LedTransient: return "LED class, transient trigger";
    case TimedOutput: return "timed_output";
    case None: break;
    }
    return "none";
}

Vibrator::Found Vibrator::find(const std::string &root)
{
    Found f;
    for (const auto &info : listInputs(root)) {
        if (testBit(info.ff, FF_RUMBLE)) {
            f.kind = ForceFeedback;
            f.path = info.path;
            return f;
        }
    }
    const std::string led = root + "/sys/class/leds/vibrator";
    // An LED-class vibrator with the transient trigger: it offers the
    // trigger ("[none] transient ..."), or has it set already (activate,
    // duration and state are there), as the constructor needs.
    if (exists(led + "/trigger")
        && (exists(led + "/activate") || readText(led + "/trigger").find("transient") != std::string::npos)) {
        f.kind = LedTransient;
        f.path = led;
        return f;
    }
    const std::string timed = root + "/sys/class/timed_output/vibrator";
    if (exists(timed + "/enable")) {
        f.kind = TimedOutput;
        f.path = timed;
    }
    return f;
}

Vibrator::Vibrator(const std::string &root)
{
    const Found f = find(root);
    if (f.kind == ForceFeedback) {
        m_fd = ::open(f.path.c_str(), O_RDWR | O_CLOEXEC);
        if (m_fd >= 0) {
            m_kind = ForceFeedback;
            m_path = f.path;
            return;
        }
    }
    const std::string led = root + "/sys/class/leds/vibrator";
    if (exists(led + "/trigger")) {
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

// ---- Accelerometer ----------------------------------------------------------------------------

Accelerometer::Accelerometer(const std::string &root, const std::string &name)
{
    const std::string base = root + "/sys/bus/iio/devices/";
    std::vector<std::string> names = name.empty() ? entries(base, "iio:device") : std::vector<std::string>{ name };
    for (const auto &n : names) {
        const std::string dir = base + n + "/";
        if (!exists(dir + "in_accel_x_raw") || !exists(dir + "in_accel_y_raw") || !exists(dir + "in_accel_z_raw"))
            continue;
        m_dir = dir;
        const std::string shared = readText(dir + "in_accel_scale");
        const std::string sharedOffset = readText(dir + "in_accel_offset");
        const char *axes[] = { "x", "y", "z" };
        for (int i = 0; i < 3; ++i) {
            const std::string own = readText(dir + "in_accel_" + axes[i] + "_scale");
            const std::string &s = !own.empty() ? own : shared;
            if (!s.empty())
                m_scale[i] = std::atof(s.c_str());
            const std::string ownOffset = readText(dir + "in_accel_" + axes[i] + "_offset");
            const std::string &o = !ownOffset.empty() ? ownOffset : sharedOffset;
            if (!o.empty())
                m_offset[i] = std::atof(o.c_str());
        }
        std::string mount = readText(dir + "in_accel_mount_matrix");
        if (mount.empty())
            mount = readText(dir + "mount_matrix");
        if (!mount.empty()) {
            double m[9];
            int count = 0;
            std::string cell;
            for (char c : mount + ";") {
                if (c == ',' || c == ';') {
                    if (count < 9)
                        m[count] = std::atof(cell.c_str());
                    ++count;
                    cell.clear();
                } else if (c != ' ' && c != '\n') {
                    cell += c;
                }
            }
            if (count == 9)
                std::copy(m, m + 9, m_mount);
        }
        return;
    }
}

bool Accelerometer::read(double *x, double *y, double *z) const
{
    if (m_dir.empty())
        return false;
    double raw[3];
    const char *axes[] = { "x", "y", "z" };
    for (int i = 0; i < 3; ++i) {
        const std::string v = readText(m_dir + "in_accel_" + axes[i] + "_raw");
        if (v.empty())
            return false;
        raw[i] = (std::atof(v.c_str()) + m_offset[i]) * m_scale[i];
    }
    *x = m_mount[0] * raw[0] + m_mount[1] * raw[1] + m_mount[2] * raw[2];
    *y = m_mount[3] * raw[0] + m_mount[4] * raw[1] + m_mount[5] * raw[2];
    *z = m_mount[6] * raw[0] + m_mount[7] * raw[1] + m_mount[8] * raw[2];
    return true;
}

// ---- Input devices: what each is ------------------------------------------------------------

std::vector<InputDevices::Event> decodeInputEvents(const struct input_event *ev, size_t count)
{
    std::vector<InputDevices::Event> out;
    for (size_t i = 0; i < count; ++i) {
        if (ev[i].type == EV_SW || (ev[i].type == EV_KEY && ev[i].value != 2))
            out.push_back({ ev[i].type, ev[i].code, ev[i].value });
    }
    return out;
}

// The keys phoenix-devices reports (keyForCode).
static const int ReportedKeys[] = { KEY_VOLUMEUP, KEY_VOLUMEDOWN, KEY_POWER, KEY_PLAYCD, KEY_PAUSECD, KEY_PLAYPAUSE,
                                    KEY_STOPCD, KEY_NEXTSONG, KEY_PREVIOUSSONG, KEY_MEDIA };

bool InputInfo::has(int type, int code) const
{
    switch (type) {
    case EV_KEY: return testBit(key, code);
    case EV_SW: return testBit(sw, code);
    case EV_ABS: return testBit(abs, code);
    case EV_REL: return testBit(rel, code);
    case EV_FF: return testBit(ff, code);
    default: return false;
    }
}

bool InputInfo::wanted(const DeviceConfig &config) const
{
    if (has(EV_SW, SW_HEADPHONE_INSERT) || has(EV_SW, SW_MICROPHONE_INSERT))
        return true;
    if (config.ringerCode >= 0 && has(config.ringerType, config.ringerCode))
        return true;
    for (int code : ReportedKeys)
        if (has(EV_KEY, code))
            return true;
    return false;
}

std::string InputInfo::busName() const
{
    switch (bus) {
    case 0: return "unknown bus";
    case BUS_PCI: return "pci";
    case BUS_USB: return "usb";
    case BUS_BLUETOOTH: return "bluetooth";
    case BUS_VIRTUAL: return "virtual";
    case BUS_I8042: return "i8042";
    case BUS_HOST: return "host";
    case BUS_I2C: return "i2c";
    case BUS_SPI: return "spi";
    default: {
        char buf[16];
        std::snprintf(buf, sizeof buf, "bus 0x%x", bus);
        return buf;
    }
    }
}

std::string InputInfo::summary(const DeviceConfig &config) const
{
    std::vector<std::string> parts;
    std::string keys;
    for (int code : ReportedKeys) {
        KeyName k;
        if (has(EV_KEY, code) && keyForCode(code, &k))
            keys += (keys.empty() ? "" : ", ") + k.name;
    }
    if (!keys.empty())
        parts.push_back("keys " + keys);
    std::string sws;
    auto addSw = [&](const std::string &n) { sws += (sws.empty() ? "" : ", ") + n; };
    if (has(EV_SW, SW_HEADPHONE_INSERT))
        addSw("headphone jack");
    if (has(EV_SW, SW_MICROPHONE_INSERT))
        addSw("microphone jack");
    if (config.ringerCode >= 0 && has(config.ringerType, config.ringerCode))
        addSw(std::string("ringer (") + (config.ringerType == EV_KEY ? "EV_KEY " : "EV_SW ") + std::to_string(config.ringerCode) + ")");
    // Switches it has that Phoenix does not use yet, worth knowing about.
    if (has(EV_SW, SW_MUTE_DEVICE) && !(config.ringerType == EV_SW && config.ringerCode == SW_MUTE_DEVICE))
        addSw("mute (SW_MUTE_DEVICE; the ringer? see device.json)");
    if (has(EV_SW, SW_DOCK))
        addSw("dock (not used)");
    if (has(EV_SW, SW_LID))
        addSw("lid (not used)");
    if (has(EV_SW, SW_TABLET_MODE))
        addSw("tablet mode (not used)");
    if (has(EV_SW, SW_LINEOUT_INSERT))
        addSw("line out (not used)");
    if (!sws.empty())
        parts.push_back("switches " + sws);
    if (testBit(ff, FF_RUMBLE))
        parts.push_back("vibrator (force feedback)");
    // What else it is, from what it reports (not Phoenix's to read: the
    // compositor's).
    if (has(EV_ABS, ABS_MT_POSITION_X))
        parts.push_back("touchscreen");
    else if (has(EV_KEY, BTN_TOUCH) && has(EV_ABS, ABS_X))
        parts.push_back("touchpad or tablet");
    if (has(EV_KEY, KEY_A) && has(EV_KEY, KEY_Z) && has(EV_KEY, KEY_ENTER))
        parts.push_back("keyboard");
    if (has(EV_REL, REL_X) && has(EV_REL, REL_Y))
        parts.push_back("pointer");
    std::string out;
    for (const auto &p : parts)
        out += (out.empty() ? "" : "; ") + p;
    return out.empty() ? "nothing Phoenix reads" : out;
}

InputInfo probeInput(const std::string &root, const std::string &node, int fd)
{
    InputInfo info;
    info.node = node;
    info.path = root + "/dev/input/" + node;
    const std::string dev = root + "/sys/class/input/" + node + "/device/";
    const std::string caps = dev + "capabilities/";
    if (exists(caps + "ev")) {
        info.fromSysfs = true;
        info.name = readText(dev + "name");
        info.bus = static_cast<int>(std::strtol(readText(dev + "id/bustype").c_str(), nullptr, 16));
        info.ev = parseBitmap(readText(caps + "ev"));
        info.key = parseBitmap(readText(caps + "key"));
        info.sw = parseBitmap(readText(caps + "sw"));
        info.abs = parseBitmap(readText(caps + "abs"));
        info.rel = parseBitmap(readText(caps + "rel"));
        info.ff = parseBitmap(readText(caps + "ff"));
        return info;
    }
    if (fd < 0)
        return info;
    char name[256] = {};
    if (::ioctl(fd, EVIOCGNAME(sizeof name - 1), name) >= 0)
        info.name = name;
    struct input_id id;
    if (::ioctl(fd, EVIOCGID, &id) >= 0)
        info.bus = id.bustype;
    info.ev = ioctlBits(fd, 0, EV_MAX);
    info.key = ioctlBits(fd, EV_KEY, KEY_MAX);
    info.sw = ioctlBits(fd, EV_SW, SW_MAX);
    info.abs = ioctlBits(fd, EV_ABS, ABS_MAX);
    info.rel = ioctlBits(fd, EV_REL, REL_MAX);
    info.ff = ioctlBits(fd, EV_FF, FF_MAX);
    return info;
}

static std::vector<std::string> eventNodes(const std::string &root)
{
    std::vector<std::string> nodes = entries(root + "/dev/input/", "event");
    std::sort(nodes.begin(), nodes.end(), nodeLess);
    return nodes;
}

std::vector<InputInfo> listInputs(const std::string &root)
{
    std::vector<InputInfo> out;
    for (const auto &n : eventNodes(root)) {
        const std::string sysCaps = root + "/sys/class/input/" + n + "/device/capabilities/ev";
        int fd = -1;
        if (!exists(sysCaps))
            fd = ::open((root + "/dev/input/" + n).c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
        const int openErrno = errno;
        out.push_back(probeInput(root, n, fd));
        if (!exists(sysCaps) && fd < 0)
            out.back().error = std::strerror(openErrno);
        if (fd >= 0)
            ::close(fd);
    }
    return out;
}

// ---- Input devices: the ones in use ------------------------------------------------------------

InputDevices::InputDevices(const std::string &root, const DeviceConfig &config)
    : m_root(root), m_config(config)
{
    rescan();
}

InputDevices::~InputDevices()
{
    for (auto &d : m_devices)
        if (d.second.fd >= 0)
            ::close(d.second.fd);
}

InputDevices::Change InputDevices::rescan()
{
    Change change;
    const std::vector<std::string> nodes = eventNodes(m_root);
    std::map<std::string, Device> retrying;     // could not be opened last time
    // Gone, or another device on the same node.
    for (auto it = m_devices.begin(); it != m_devices.end();) {
        struct stat st;
        const bool there = std::find(nodes.begin(), nodes.end(), it->first) != nodes.end()
            && ::stat(it->second.info.path.c_str(), &st) == 0;
        const bool same = there && st.st_ino == it->second.ino && st.st_rdev == it->second.rdev;
        if (same && it->second.info.error.empty() && !it->second.hungUp) {
            ++it;
            continue;
        }
        if (same && !it->second.hungUp) {
            retrying[it->first] = it->second;
        } else {
            if (it->second.fd >= 0)
                ::close(it->second.fd);
            change.removed.push_back(it->second.info);
        }
        it = m_devices.erase(it);
    }
    // New, or tried again.
    for (const auto &n : nodes) {
        if (m_devices.count(n))
            continue;
        const std::string path = m_root + "/dev/input/" + n;
        Device d;
        struct stat st;
        if (::stat(path.c_str(), &st) != 0)
            continue;
        d.ino = st.st_ino;
        d.rdev = st.st_rdev;
        // Open to read it (O_NONBLOCK: a FIFO in the tests' fake /dev opens
        // without a writer); keep it open only if it is used.
        const int fd = ::open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
        const int openErrno = errno;
        d.info = probeInput(m_root, n, fd);
        if (fd < 0) {
            // Kept, to say so once, and tried again on the next event (udev
            // may still be setting its permissions: IN_ATTRIB follows).
            d.info.error = std::strerror(openErrno);
        } else if (d.info.wanted(m_config)) {
            d.fd = fd;
        } else {
            ::close(fd);
        }
        const bool again = retrying.count(n) > 0;
        if (!(again && !d.info.error.empty()))
            change.added.push_back(d.info);
        m_devices[n] = d;
    }
    return change;
}

void InputDevices::drop(int fd)
{
    for (auto &d : m_devices) {
        if (d.second.fd == fd) {
            ::close(fd);
            d.second.fd = -1;
            d.second.hungUp = true;   // the next rescan() says it went, and looks again
            return;
        }
    }
}

std::vector<int> InputDevices::fds() const
{
    std::vector<int> out;
    for (const auto &d : m_devices)
        if (d.second.fd >= 0)
            out.push_back(d.second.fd);
    return out;
}

std::vector<std::string> InputDevices::opened() const
{
    std::vector<std::string> out;
    for (const auto &d : m_devices)
        if (d.second.fd >= 0)
            out.push_back(d.second.info.path);
    return out;
}

std::vector<InputInfo> InputDevices::used() const
{
    std::vector<InputInfo> out;
    for (const auto &d : m_devices)
        if (d.second.fd >= 0)
            out.push_back(d.second.info);
    return out;
}

std::vector<InputInfo> InputDevices::seen() const
{
    std::vector<InputInfo> out;
    for (const auto &d : m_devices)
        out.push_back(d.second.info);
    return out;
}

std::string InputDevices::pathOf(int fd) const
{
    for (const auto &d : m_devices)
        if (d.second.fd == fd)
            return d.second.info.path;
    return std::string();
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

bool InputDevices::hasCode(int type, int code) const
{
    for (const auto &d : m_devices)
        if (d.second.fd >= 0 && d.second.info.has(type, code))
            return true;
    return false;
}

int InputDevices::switchState(int type, int code) const
{
    for (const auto &d : m_devices) {
        const int fd = d.second.fd;
        if (fd < 0 || !d.second.info.has(type, code))
            continue;
        if (type == EV_SW && code <= SW_MAX) {
            Bits sw(SW_MAX / LongBits + 1, 0);
            if (::ioctl(fd, EVIOCGSW(sw.size() * sizeof(unsigned long)), sw.data()) >= 0)
                return testBit(sw, code) ? 1 : 0;
        } else if (type == EV_KEY && code <= KEY_MAX) {
            Bits keys(KEY_MAX / LongBits + 1, 0);
            if (::ioctl(fd, EVIOCGKEY(keys.size() * sizeof(unsigned long)), keys.data()) >= 0)
                return testBit(keys, code) ? 1 : 0;
        }
    }
    return -1;
}

// ---- All of it --------------------------------------------------------------------------------

static std::string describeInput(const InputInfo &i, const DeviceConfig &config, bool used)
{
    return i.path + " \"" + i.name + "\" (" + i.busName() + (i.fromSysfs ? "" : ", from the device") + "): "
        + i.summary(config) + (!i.error.empty() ? " [cannot open: " + i.error + "]" : used ? " [used]" : " [not used]");
}

DeviceProbe::DeviceProbe(const std::string &root, const DeviceConfig &config)
    : m_root(root), m_config(config)
{
    Backlight b(root, config.backlight);
    if (b.available())
        backlight.reset(new Backlight(b));
    if (Vibrator::find(root).kind != Vibrator::None)
        vibrator.reset(new Vibrator(root));
    LightSensor l(root, config.lightSensor);
    if (l.available())
        lightSensor.reset(new LightSensor(l));
    Accelerometer a(root, config.accelerometer);
    if (a.available())
        accelerometer.reset(new Accelerometer(a));
    input.reset(new InputDevices(root, config));
}

DeviceProbe::Changes DeviceProbe::rescan()
{
    Changes c;
    Backlight b(m_root, m_config.backlight);
    const std::string was = backlight ? backlight->dir() : std::string();
    if (b.dir() != was) {
        c.backlight = true;
        backlight.reset(b.available() ? new Backlight(b) : nullptr);
        c.log.push_back("backlight " + (b.available() ? b.dir() : std::string("gone")) + (was.empty() ? "" : " (was " + was + ")"));
    }
    const Vibrator::Found f = Vibrator::find(m_root);
    const Vibrator::Found had{ vibrator ? vibrator->kind() : Vibrator::None, vibrator ? vibrator->path() : std::string() };
    if (!(f == had)) {
        c.vibrator = true;
        vibrator.reset();   // let go of the old one first (its fd)
        if (f.kind != Vibrator::None)
            vibrator.reset(new Vibrator(m_root));
        c.log.push_back(std::string("vibrator ") + Vibrator::kindName(vibrator ? vibrator->kind() : Vibrator::None)
                        + (vibrator ? " " + vibrator->path() : std::string()));
    }
    LightSensor l(m_root, m_config.lightSensor);
    const std::string hadLight = lightSensor ? lightSensor->source() : std::string();
    if (l.source() != hadLight) {
        c.lightSensor = true;
        lightSensor.reset(l.available() ? new LightSensor(l) : nullptr);
        c.log.push_back("light sensor " + (l.available() ? l.source() : std::string("gone")));
    }
    Accelerometer a(m_root, m_config.accelerometer);
    const std::string hadAccel = accelerometer ? accelerometer->dir() : std::string();
    if (a.dir() != hadAccel) {
        c.accelerometer = true;
        accelerometer.reset(a.available() ? new Accelerometer(a) : nullptr);
        c.log.push_back("accelerometer " + (a.available() ? a.dir() : std::string("gone")));
    }
    c.input = input->rescan();
    const std::vector<std::string> usedNow = input->opened();
    for (const auto &i : c.input.added)
        c.log.push_back("input added " + describeInput(i, m_config, std::find(usedNow.begin(), usedNow.end(), i.path) != usedNow.end()));
    for (const auto &i : c.input.removed)
        c.log.push_back("input removed " + i.path + " \"" + i.name + "\"");
    return c;
}

std::vector<std::string> DeviceProbe::describe() const
{
    std::vector<std::string> out;
    out.push_back("backlight " + (backlight ? backlight->dir() + " (max " + std::to_string(backlight->maxBrightness()) + ")" : std::string("none")));
    out.push_back(std::string("vibrator ") + Vibrator::kindName(vibrator ? vibrator->kind() : Vibrator::None)
                  + (vibrator ? " " + vibrator->path() : std::string()));
    out.push_back("light sensor " + (lightSensor ? lightSensor->source() : std::string("none")));
    out.push_back("accelerometer " + (accelerometer ? accelerometer->dir() : std::string("none")));
    const std::vector<std::string> usedNow = input->opened();
    for (const auto &i : input->seen())
        out.push_back("input " + describeInput(i, m_config, std::find(usedNow.begin(), usedNow.end(), i.path) != usedNow.end()));
    return out;
}

// ---- Hotplug ----------------------------------------------------------------------------------

bool parseUevent(const char *buf, size_t len, Uevent *out)
{
    *out = Uevent();
    // libudev's own messages (on group 2) start with "libudev"; the kernel's
    // with ACTION@DEVPATH.
    if (len < 3 || std::memchr(buf, '@', std::min<size_t>(len, 64)) == nullptr || std::strncmp(buf, "libudev", 7) == 0)
        return false;
    size_t i = 0;
    bool first = true;
    while (i < len) {
        const char *s = buf + i;
        const size_t n = strnlen(s, len - i);
        const std::string field(s, n);
        if (first) {
            const size_t at = field.find('@');
            if (at == std::string::npos)
                return false;
            out->action = field.substr(0, at);
            out->devpath = field.substr(at + 1);
            first = false;
        } else {
            const size_t eq = field.find('=');
            if (eq != std::string::npos) {
                const std::string k = field.substr(0, eq), v = field.substr(eq + 1);
                if (k == "ACTION") out->action = v;
                else if (k == "DEVPATH") out->devpath = v;
                else if (k == "SUBSYSTEM") out->subsystem = v;
                else if (k == "DEVNAME") out->devname = v;
            }
        }
        i += n + 1;
    }
    return !out->action.empty();
}

bool ueventMatters(const Uevent &e)
{
    if (e.action != "add" && e.action != "remove" && e.action != "change" && e.action != "bind" && e.action != "unbind")
        return false;
    return e.subsystem == "input" || e.subsystem == "iio" || e.subsystem == "backlight" || e.subsystem == "leds"
        || e.subsystem == "timed_output";
}

HotplugMonitor::HotplugMonitor(const std::string &root, bool uevents)
    : m_root(root)
{
    m_inotify = ::inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (m_inotify >= 0)
        watchInput();
    if (!uevents) {
        m_netlinkError = "not asked for";
        return;
    }
    m_netlink = ::socket(AF_NETLINK, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, NETLINK_KOBJECT_UEVENT);
    if (m_netlink < 0) {
        m_netlinkError = std::strerror(errno);
        return;
    }
    struct sockaddr_nl addr;
    std::memset(&addr, 0, sizeof addr);
    addr.nl_family = AF_NETLINK;
    addr.nl_groups = 1;     // the kernel's own uevents (udev re-sends on group 2)
    if (::bind(m_netlink, reinterpret_cast<struct sockaddr *>(&addr), sizeof addr) < 0) {
        m_netlinkError = std::strerror(errno);
        ::close(m_netlink);
        m_netlink = -1;
    }
}

HotplugMonitor::~HotplugMonitor()
{
    if (m_inotify >= 0)
        ::close(m_inotify);
    if (m_netlink >= 0)
        ::close(m_netlink);
}

void HotplugMonitor::watchInput()
{
    const uint32_t mask = IN_CREATE | IN_DELETE | IN_ATTRIB | IN_MOVED_TO | IN_MOVED_FROM | IN_DELETE_SELF;
    m_inputWatch = ::inotify_add_watch(m_inotify, (m_root + "/dev/input").c_str(), mask);
    if (m_inputWatch < 0 && m_devWatch < 0) {
        // No /dev/input yet (no input device at all): wait for it in /dev.
        m_devWatch = ::inotify_add_watch(m_inotify, (m_root + "/dev").c_str(), IN_CREATE | IN_MOVED_TO);
    }
}

std::vector<int> HotplugMonitor::fds() const
{
    std::vector<int> out;
    if (m_inotify >= 0)
        out.push_back(m_inotify);
    if (m_netlink >= 0)
        out.push_back(m_netlink);
    return out;
}

bool HotplugMonitor::readFrom(int fd, std::vector<std::string> *what)
{
    bool changed = false;
    if (fd == m_inotify) {
        alignas(struct inotify_event) char buf[4096];
        for (;;) {
            const ssize_t n = ::read(m_inotify, buf, sizeof buf);
            if (n <= 0)
                break;
            for (ssize_t i = 0; i < n;) {
                const auto *e = reinterpret_cast<const struct inotify_event *>(buf + i);
                const std::string name = e->len ? e->name : "";
                if (e->wd == m_devWatch && name == "input") {
                    watchInput();
                    changed = true;
                    if (what) what->push_back("/dev/input appeared");
                } else if (e->wd == m_inputWatch) {
                    if (e->mask & (IN_DELETE_SELF | IN_IGNORED)) {
                        // /dev/input itself went: wait for it again.
                        m_inputWatch = -1;
                        m_devWatch = -1;
                        watchInput();
                        changed = true;
                    } else if (name.compare(0, 5, "event") == 0) {
                        changed = true;
                        if (what)
                            what->push_back(std::string("/dev/input/") + name
                                            + ((e->mask & (IN_CREATE | IN_MOVED_TO)) ? " created"
                                               : (e->mask & (IN_DELETE | IN_MOVED_FROM)) ? " deleted" : " changed"));
                    }
                }
                i += static_cast<ssize_t>(sizeof(struct inotify_event) + e->len);
            }
        }
    } else if (fd == m_netlink) {
        char buf[8192];
        for (;;) {
            struct sockaddr_nl from;
            socklen_t fromLen = sizeof from;
            const ssize_t n = ::recvfrom(m_netlink, buf, sizeof buf, 0, reinterpret_cast<struct sockaddr *>(&from), &fromLen);
            if (n <= 0)
                break;
            // Only the kernel's (port 0): another process could send on the group.
            if (from.nl_pid != 0)
                continue;
            Uevent e;
            if (parseUevent(buf, static_cast<size_t>(n), &e) && ueventMatters(e)) {
                changed = true;
                if (what)
                    what->push_back("uevent " + e.action + " " + e.subsystem + " " + e.devpath);
            }
        }
    }
    return changed;
}

std::string HotplugMonitor::describe() const
{
    std::string out = m_inputWatch >= 0 ? "inotify on " + m_root + "/dev/input"
                    : m_devWatch >= 0 ? "inotify on " + m_root + "/dev (no /dev/input yet)"
                    : m_inotify < 0 ? std::string("no inotify")
                    : "nothing to watch (no " + m_root + "/dev)";
    out += m_netlink >= 0 ? "; kernel uevents" : "; no kernel uevents (" + m_netlinkError + ")";
    return out;
}

// ---- --probe ------------------------------------------------------------------------------------

// ---- The battery and the chargers ---------------------------------------------------

PowerSupplies::PowerSupplies(const std::string &root)
    : m_dir(root + "/sys/class/power_supply")
{
}

PowerSupplies::Status PowerSupplies::read() const
{
    Status st;
    bool batteryCharging = false;
    for (const std::string &name : entries(m_dir, "")) {
        const std::string dir = m_dir + "/" + name + "/";
        const std::string type = readText(dir + "type");
        if (type == "Battery") {
            const std::string cap = readText(dir + "capacity");
            if (cap.empty() || st.present)
                continue;
            st.present = true;
            st.percent = std::max(0, std::min(100, std::atoi(cap.c_str())));
            const std::string status = readText(dir + "status");
            batteryCharging = status == "Charging" || status == "Full";
            const std::string temp = readText(dir + "temp");
            if (!temp.empty())
                st.temperatureC = std::atoi(temp.c_str()) / 10.0;
            st.currentmA = static_cast<int>(std::atol(readText(dir + "current_now").c_str()) / 1000);
            st.voltagemV = static_cast<int>(std::atol(readText(dir + "voltage_now").c_str()) / 1000);
            st.capacitymAh = static_cast<int>(std::atol(readText(dir + "charge_full").c_str()) / 1000);
        } else if (readText(dir + "online") == "1") {
            // A USB supply is a computer's port unless it says it is a
            // charger (usb_type's chosen one in brackets: [DCP], [CDP]...).
            const std::string usbType = readText(dir + "usb_type");
            const bool host = type == "USB" && (usbType.empty() || usbType.find("[SDP]") != std::string::npos
                                                || usbType.find("[Unknown]") != std::string::npos);
            if (st.charger == "none" || st.charger == "pc")
                st.charger = host ? "pc" : "wall";
        }
    }
    st.charging = st.charger != "none" || batteryCharging;
    return st;
}

std::string probeReport(const std::string &root, const std::string &configPath)
{
    const DeviceConfig config = DeviceConfig::load(configPath);
    std::string out;
    out += "phoenix-devices --probe (root " + (root.empty() ? std::string("/") : root) + ")\n";
    out += "device.json " + configPath + ": " + (config.loaded ? "read" : "none (everything found by looking)") + "\n";
    out += "  ringer switch: " + (config.ringerCode < 0 ? std::string("none (the ringer is always on)")
                                  : std::string(config.ringerType == EV_KEY ? "EV_KEY " : "EV_SW ") + std::to_string(config.ringerCode)
                                      + ", silent at " + std::to_string(config.ringerSilentValue)) + "\n";
    if (!config.backlight.empty())
        out += "  backlight: " + config.backlight + "\n";
    if (!config.lightSensor.empty())
        out += "  light sensor: " + config.lightSensor + "\n";
    if (!config.accelerometer.empty())
        out += "  accelerometer: " + config.accelerometer + "\n";

    Backlight b(root, config.backlight);
    out += "backlight: " + (b.available() ? b.dir() + " (max_brightness " + std::to_string(b.maxBrightness()) + ")" : std::string("none")) + "\n";
    const Vibrator::Found v = Vibrator::find(root);
    out += std::string("vibrator: ") + Vibrator::kindName(v.kind) + (v.path.empty() ? "" : " " + v.path) + "\n";
    LightSensor l(root, config.lightSensor);
    out += "light sensor: " + (l.available() ? l.source() + " (now " + std::to_string(l.read()) + " lux)" : std::string("none")) + "\n";
    Accelerometer a(root, config.accelerometer);
    double ax = 0, ay = 0, az = 0;
    OrientationFilter held;
    if (a.available() && a.read(&ax, &ay, &az))
        held.update(ax, ay, az);
    out += "accelerometer: " + (a.available() ? a.dir() + " (now " + std::to_string(ax) + ", " + std::to_string(ay) + ", "
                                 + std::to_string(az) + " m/s2: " + (held.orientation().empty() ? std::string("not held still")
                                                                     : held.orientation()) + ")"
                                : std::string("none")) + "\n";

    const std::vector<InputInfo> inputs = listInputs(root);
    out += "input devices: " + std::to_string(inputs.size()) + "\n";
    bool jack = false, mic = false, ringer = false;
    std::string muteSwitches;
    for (const auto &i : inputs) {
        const bool used = i.wanted(config);
        out += "  " + describeInput(i, config, used) + "\n";
        jack = jack || i.has(EV_SW, SW_HEADPHONE_INSERT);
        mic = mic || i.has(EV_SW, SW_MICROPHONE_INSERT);
        ringer = ringer || (config.ringerCode >= 0 && i.has(config.ringerType, config.ringerCode));
        if (i.has(EV_SW, SW_MUTE_DEVICE))
            muteSwitches += (muteSwitches.empty() ? "" : ", ") + i.node;
    }
    out += std::string("headset jack: ") + (jack ? (mic ? "yes, with its microphone" : "yes") : "none found") + "\n";
    if (config.ringerCode >= 0)
        out += std::string("ringer switch: ") + (ringer ? "found" : "not on any device (device.json names it)") + "\n";
    else if (!muteSwitches.empty())
        out += "ringer switch: none in device.json; SW_MUTE_DEVICE on " + muteSwitches
            + " may be it: \"ringerSwitch\": {\"type\": \"EV_SW\", \"code\": 14, \"silentValue\": 1}\n";
    else
        out += "ringer switch: none (the ringer is always on)\n";
    HotplugMonitor hotplug(root, root.empty());
    out += "hotplug: " + hotplug.describe() + "\n";
    return out;
}

} // namespace devices
} // namespace phoenix
